# TCL Marketplace — Deploy Guide

## Prerequisites
- Rust + `cargo` installed
- `mxpy` (MultiversX Python SDK) installed: `pip install mxpy`
- Wallet PEM/keystore file

## Build
```bash
cd contracts/marketplace
mxpy contract build
```
This generates `output/tcl-marketplace.wasm` and `output/tcl-marketplace.abi.json`.

## Deploy (Mainnet)
```bash
mxpy contract deploy \
  --bytecode output/tcl-marketplace.wasm \
  --abi output/tcl-marketplace.abi.json \
  --arguments 2 \
  --gas-limit 100000000 \
  --proxy https://gateway.multiversx.com \
  --chain 1 \
  --pem YOUR_WALLET.pem \
  --send
```
The `2` argument = 2% platform fee.

## After Deploy
1. Copy the deployed contract address from the output.
2. Update `MARKETPLACE_CONTRACT` in `MarketPlaceNFT.html`.
3. Set `ROYALTY_ADDRESS` to your team wallet address.

## Listing an NFT (manual via mxpy)
```bash
mxpy contract call $CONTRACT \
  --function listNFT \
  --token-transfers TCLDAGGER-f9869a-31:1 \
  --arguments <price_in_TCL_smallest_unit> <royalty_wallet> <royalty_bps> \
  --gas-limit 15000000 \
  --pem YOUR_WALLET.pem \
  --proxy https://gateway.multiversx.com \
  --chain 1 --send
```

## Token info
- TCL Token: `TCL-fe459d` (18 decimals)
- 1 TCL = 1_000_000_000_000_000_000 (10^18)
