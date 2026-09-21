const http = require("http");

const PORT = Number(process.env.PORT || 10000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const REVO_RPC_URL = process.env.REVO_RPC_URL || "https://libertas.revolutionchain.io";
const REVO_CHAIN_ID = 73863;
const REVO_RECEIVER = String(
  process.env.REVO_RECEIVER ||
  "0x26459bDC7636aC14F1ef9cdEc6EB5889514B02E8"
).toLowerCase();

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 20000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function validAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v || "").trim());
}

function validTxHash(v) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(v || "").trim());
}

function hexToBigInt(v) {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) {
    throw new Error("Invalid hexadecimal blockchain value.");
  }
  return BigInt(v);
}

async function rpc(method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(REVO_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now()
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`Libertas RPC HTTP ${response.status}`);
    }
    if (data.error) {
      throw new Error(data.error.message || "Libertas RPC error.");
    }
    return data.result;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Libertas RPC request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyRevoTransaction({ amount, txHash, from }) {
  if (!validTxHash(txHash)) {
    return { ok: false, error: "Invalid REVO transaction hash." };
  }
  if (!validAddress(from)) {
    return { ok: false, error: "Invalid REVO sender address." };
  }

  const expectedReceiver = REVO_RECEIVER;

  if (!validAddress(expectedReceiver)) {
    return { ok: false, error: "Configured ESCROW X REVO receiver address is invalid." };
  }

  const requestedAmount = Number(amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return { ok: false, error: "Invalid REVO amount." };
  }

  try {
    const chainIdHex = await rpc("eth_chainId");
    const chainId = Number(BigInt(chainIdHex));
    if (chainId !== REVO_CHAIN_ID) {
      return {
        ok: false,
        error: `Wrong blockchain: RPC returned Chain ID ${chainId}, expected ${REVO_CHAIN_ID}.`
      };
    }

    const tx = await rpc("eth_getTransactionByHash", [txHash]);
    if (!tx) {
      return { ok: false, error: "Transaction hash was not found on Libertas." };
    }

    const txFrom = String(tx.from || "").toLowerCase();
    const txTo = String(tx.to || "").toLowerCase();

    // Sender is intentionally NOT restricted to a server-side authorized wallet.
    // Any valid sender may deposit; EscrowX performs its own internal security checks.
    if (!validAddress(txFrom)) {
      return { ok: false, error: "Blockchain sender address is invalid." };
    }

    // Receiver is always the server-configured EscrowX custody receiver.
    // The client cannot override it through the verification request.
    if (txTo !== expectedReceiver) {
      return { ok: false, error: "Blockchain receiver does not match the ESCROW X REVO deposit address." };
    }

    const valueWei = hexToBigInt(tx.value || "0x0");
    const amountRevo = Number(valueWei) / 1e18;

    if (!Number.isFinite(amountRevo) || amountRevo <= 0) {
      return { ok: false, error: "The transaction contains no REVO value transfer." };
    }

    if (Math.abs(amountRevo - requestedAmount) > 1e-8) {
      return {
        ok: false,
        error: `Amount mismatch: blockchain shows ${amountRevo} REVO, but you entered ${requestedAmount} REVO.`
      };
    }

    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (!receipt) {
      return { ok: false, error: "Transaction exists but has no receipt yet. It is not confirmed." };
    }

    if (String(receipt.status || "").toLowerCase() !== "0x1") {
      return { ok: false, error: "Transaction failed on Libertas." };
    }

    const blockNumber = receipt.blockNumber ? Number(BigInt(receipt.blockNumber)) : null;

    return {
      ok: true,
      realConnector: true,
      txHash,
      from: txFrom,
      to: txTo,
      amount: amountRevo,
      status: "SUCCESS",
      action: "TRANSFER",
      asset: "REVO",
      network: "Revolution Network · Libertas",
      chainId: REVO_CHAIN_ID,
      blockIndex: blockNumber,
      createdAt: null,
      verifiedAt: new Date().toISOString(),
      verificationMode: "REVOLUTION LIBERTAS JSON-RPC",
      rpc: REVO_RPC_URL,
      receiver: REVO_RECEIVER,
      message: "REVO transaction verified directly against Libertas JSON-RPC."
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Unable to reach the Revolution Network Libertas RPC."
    };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.method === "GET" && req.url === "/health") {
    try {
      const chainIdHex = await rpc("eth_chainId");
      const chainId = Number(BigInt(chainIdHex));
      return sendJson(res, 200, {
        ok: chainId === REVO_CHAIN_ID,
        service: "ESCROW X P2P REVO verification server",
        network: "Revolution Network · Libertas",
        chainId,
        expectedChainId: REVO_CHAIN_ID,
        rpc: REVO_RPC_URL,
        receiver: REVO_RECEIVER,
        rpcConnected: chainId === REVO_CHAIN_ID
      });
    } catch (error) {
      return sendJson(res, 503, {
        ok: false,
        service: "ESCROW X P2P REVO verification server",
        network: "Revolution Network · Libertas",
        expectedChainId: REVO_CHAIN_ID,
        rpc: REVO_RPC_URL,
        receiver: REVO_RECEIVER,
        rpcConnected: false,
        error: error?.message || "Libertas RPC unavailable."
      });
    }
  }

  if (req.method === "POST" && req.url === "/revo-verify-server") {
    try {
      const body = await readBody(req);

      const result = await verifyRevoTransaction({
        amount: body.amount,
        txHash: body.txHash,
        from: body.from
      });

      return sendJson(res, result.ok ? 200 : 400, result);
    } catch {
      return sendJson(res, 400, {
        ok: false,
        error: "Invalid JSON request."
      });
    }
  }

  return sendJson(res, 404, {
    ok: false,
    error: "Not found."
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ESCROW X P2P REVO verification server listening on 0.0.0.0:${PORT}`);
});
