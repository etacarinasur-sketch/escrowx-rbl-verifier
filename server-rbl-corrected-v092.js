const http = require("http");

const PORT = process.env.PORT || 10000;
const RUBI_API = "https://blockchain.rubi.click";

const DEPOSIT_ADDRESS =
  "0xd816a54f2d0edceca74062721b7f93dd56e182c6";

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end(body);
}

async function verifyRubiTransaction(amount, txHash) {
  const requestedAmount = Number(amount);
  const tx = String(txHash || "").trim().toLowerCase();

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return { ok: false, error: "Invalid requested amount." };
  }

  if (!/^0x[a-f0-9]{64}$/.test(tx)) {
    return { ok: false, error: "Invalid Rubi transaction hash." };
  }

  const url = `${RUBI_API}/transactions/${encodeURIComponent(tx)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Rubi API returned HTTP ${response.status}.`
      };
    }

    const chain = await response.json();

    const chainHash = String(chain?.hash || "").trim().toLowerCase();
    const chainFrom = String(chain?.from || "").trim().toLowerCase();
    const chainTo = String(chain?.to || "").trim().toLowerCase();
    const action = String(chain?.action || "").trim().toUpperCase();
    const asset = String(chain?.from_asset_type || "").trim().toUpperCase();
    const toAsset = String(chain?.to_asset_type || "").trim().toUpperCase();
    const status = String(chain?.status || "").trim().toUpperCase();
    const fromAmount = Number(chain?.from_amount);
    const toAmount = Number(chain?.to_amount);

    if (chainHash !== tx) {
      return { ok: false, error: "Transaction hash mismatch." };
    }

    if (status !== "SUCCESS") {
      return { ok: false, error: "Transaction is not successful on Rubi." };
    }

    if (action !== "TRANSFER") {
      return { ok: false, error: "Transaction is not a Rubi transfer." };
    }

    if (chainTo !== DEPOSIT_ADDRESS.toLowerCase()) {
      return { ok: false, error: "Destination address does not match the ESCROW X deposit address." };
    }

    if (asset !== "RUBI_BLOCK" || toAsset !== "RUBI_BLOCK") {
      return { ok: false, error: "Transaction asset is not RUBI_BLOCK." };
    }

    if (
      !Number.isFinite(fromAmount) ||
      !Number.isFinite(toAmount) ||
      fromAmount <= 0 ||
      fromAmount !== toAmount
    ) {
      return { ok: false, error: "Invalid blockchain amount data." };
    }

    if (Math.abs(fromAmount - requestedAmount) > 1e-8) {
      return {
        ok: false,
        error: `Amount mismatch: blockchain shows ${fromAmount} RBL, but you entered ${requestedAmount} RBL.`
      };
    }

    return {
      ok: true,
      realConnector: true,
      txHash: chainHash,
      from: chainFrom,
      to: chainTo,
      amount: fromAmount,
      status,
      action,
      asset: "RUBI_BLOCK",
      blockIndex: chain.block_index,
      createdAt: chain.created_at,
      verifiedAt: chain.verified_at,
      fee: chain.fee,
      verificationMode: "RUBI BLOCKCHAIN API",
      message: "RBL transaction verified directly against the Rubi blockchain API."
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, error: "Rubi blockchain request timed out." };
    }

    return {
      ok: false,
      error: "Unable to reach the Rubi blockchain API."
    };
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "ESCROW X P2P Rubi verification server"
    });
  }

  if (req.method === "POST" && req.url === "/rbl-verify-server") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });

    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const result = await verifyRubiTransaction(data.amount, data.txHash);

        return sendJson(res, result.ok ? 200 : 400, result);
      } catch {
        return sendJson(res, 400, {
          ok: false,
          error: "Invalid JSON request."
        });
      }
    });

    return;
  }

  return sendJson(res, 404, {
    ok: false,
    error: "Not found."
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ESCROW X P2P Rubi verification server listening on port ${PORT}`);
});
