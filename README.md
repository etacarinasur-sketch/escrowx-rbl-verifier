# ESCROW X P2P — RBL Verification Server

This is the small server that sits between the ESCROW X HTML prototype and the Rubi blockchain API.

## Endpoints

- `GET /health`
- `POST /rbl-verify-server`

The POST body is:

```json
{
  "amount": 1,
  "txHash": "0x..."
}
```

The server checks the Rubi transaction against:

`https://blockchain.rubi.click/transactions/<TX_HASH>`

It validates hash, SUCCESS status, TRANSFER action, authorized sender, ESCROW X deposit address, RUBI_BLOCK asset, and amount.

## Render

Use a Render Web Service.

Build Command:
`npm install`

Start Command:
`npm start`

The service must expose the Render-provided `PORT`; this server already uses it and listens on `0.0.0.0`.

For a prototype, Render's Free Web Service is sufficient, but it can sleep after inactivity. It is not intended as production infrastructure.
