# CDX Pulse — Uniswap V2 Auto Buy/Sell Bot

## Overview

Yeh ek cron-driven Ethereum mainnet bot hai jo **CDX** ko Uniswap V2 par ETH se khareedta hai, aur 30 minute baad wapas ETH mein bechta hai.
Har trade rotating USD clips use karti hai: **$10, $5, $20**.
Default **DRY_RUN=true** hai — pehle simulate, phir live.

## Setup (Ubuntu VPS)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip
cd /opt
# unzip cdx-bot.zip yahan extract karo
cd cdx-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
nano .env
```

## .env configuration

| Key | Matlab |
| --- | --- |
| `PRIVATE_KEY` | Dedicated bot wallet ki hex key. Kabhi log mat karo. |
| `RPC_URL` | Alchemy / Infura / apna node. Public RPC rate-limit ho sakta hai. |
| `WALLET_ADDRESS` | Usi key ka address. Checksum optional, bot checksum karega. |
| `CDX_TOKEN_ADDRESS` | `0x27DdDb492c9e593472D28722ED762c04f3d7221f` |
| `DRY_RUN` | `true` = sign/send nahi hota, sirf quote + log |

## DRY_RUN testing

```bash
source venv/bin/activate
python buy_bot.py
python sell_bot.py
tail -n 50 logs/buy.log
tail -n 50 logs/sell.log
```

Agar logs mein `DRY_RUN=true — tx sign/send skip` dikhe, setup theek hai.
`state.json` ke `buy_index` / `sell_index` har run par rotate hote hain.

## Manual run

```bash
python buy_bot.py
python sell_bot.py
```

## Cron setup

```
0 * * * * cd /opt/cdx-bot && ./venv/bin/python buy_bot.py >> logs/cron_buy.log 2>&1
30 * * * * cd /opt/cdx-bot && ./venv/bin/python sell_bot.py >> logs/cron_sell.log 2>&1
```

`crontab -e` mein paste karo. Pehle `DRY_RUN=true` ke sath 24h chalao.

## Logs

```bash
tail -f logs/buy.log
tail -f logs/sell.log
tail -f logs/cron_buy.log
```

Rotating file handler: 5 MB × 3 backups.

## Security warnings

- Private key **sirf** is VPS `.env` mein rakho. Git, screenshots, Discord — nahi.
- Naya dedicated wallet banao. Andar sirf wahi ETH rakho jo bot ko chahiye.
- `.env` permissions: `chmod 600 .env`
- `MAX_GAS_PRICE_GWEI=50` se high-gas hours skip ho jate hain.
- CDX is token par **permissioned / EUR-backed** likha hai. Allowlist ke baghair transfer revert ho sakta hai.

## Honeypot check

1. [Etherscan token page](https://etherscan.io/token/0x27DdDb492c9e593472D28722ED762c04f3d7221f) kholo.
2. Holders + recent transfers dekho. Kya unaffiliated wallets sell kar rahe hain?
3. Contract tab: `pause`, `blacklist`, `isFrozen` jaisi functions search karo.
4. Uniswap V2 pair factory se confirm karo. Agar V2 pair nahi hai, yeh bot skip/fail karega — V2 router `getAmountsOut` ke baghair swap nahi banta.
5. Tiny size se pehle khud ek buy **and** sell manually karo.

## Constants

- Router `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`
- WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`
- Chainlink ETH/USD `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`
- Slippage 5%, swap gas 300k, approve 100k
- web3.py v6: `signed.raw_transaction` (not `rawTransaction`)
- EIP-1559 fees, legacy `gasPrice` fallback
