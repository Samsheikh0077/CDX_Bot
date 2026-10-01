"""Hourly CDX buy: ETH -> CDX on Uniswap V2. Cron: 0 * * * *"""

from __future__ import annotations

import sys
import time

from web3 import Web3

import config
from utils import (
    fill_tx,
    gas_over_cap,
    get_account,
    get_eth_balance,
    get_eth_price_usd,
    get_web3,
    load_abi,
    next_index,
    send_transaction,
    setup_logger,
    strip_internal,
    usd_to_eth,
)


def main() -> int:
    logger = setup_logger("buy")
    logger.info("=== buy_bot start DRY_RUN=%s ===", config.DRY_RUN)
    try:
        w3 = get_web3()
        account = get_account()
        if account.address.lower() != config.WALLET_ADDRESS.lower():
            logger.warning(
                "Wallet mismatch: key=%s env=%s — env address use hoga 'to' ke liye",
                account.address,
                config.WALLET_ADDRESS,
            )

        router_abi = load_abi(f"{config.ABI_DIR}/uniswap_v2_router.json")
        router = w3.eth.contract(address=config.UNISWAP_V2_ROUTER, abi=router_abi)

        eth_price = get_eth_price_usd(w3)
        logger.info("ETH/USD (Chainlink) = %.4f", eth_price)

        idx = next_index("buy_index", len(config.BUY_AMOUNTS_USD))
        usd = config.BUY_AMOUNTS_USD[idx]
        eth_amount = usd_to_eth(usd, eth_price)
        eth_wei = int(w3.to_wei(eth_amount, "ether"))
        logger.info("Clip #%s  $%s  ->  %.8f ETH (%s wei)", idx, usd, eth_amount, eth_wei)

        bal = get_eth_balance(w3, account.address)
        need = eth_amount + config.GAS_BUFFER_ETH
        logger.info("ETH balance=%.6f  need>=%.6f", bal, need)
        if bal < need:
            logger.warning("Insufficient ETH. Skip. Top up dedicated wallet.")
            return 0

        path = [config.WETH, config.CDX_TOKEN]
        amounts = router.functions.getAmountsOut(eth_wei, path).call()
        amount_out = int(amounts[-1])
        amount_out_min = int(amount_out * (1 - config.SLIPPAGE))
        deadline = int(time.time()) + config.DEADLINE_SECONDS
        logger.info(
            "getAmountsOut CDX=%s  amountOutMin=%s (slippage=%.0f%%) deadline=%s",
            amount_out,
            amount_out_min,
            config.SLIPPAGE * 100,
            deadline,
        )

        fn = router.functions.swapExactETHForTokens(
            amount_out_min,
            path,
            config.WALLET_ADDRESS,
            deadline,
        )
        tx = fill_tx(
            w3,
            account,
            fn.build_transaction({"value": eth_wei, "from": account.address}),
            gas=config.GAS_LIMIT_SWAP,
        )
        if gas_over_cap(tx):
            logger.warning(
                "Gas cap hit (%.2f gwei > %s). Skip this hour.",
                tx.get("_max_gwei"),
                config.MAX_GAS_PRICE_GWEI,
            )
            return 0

        receipt = send_transaction(w3, account, strip_internal(tx), logger)
        status = int(getattr(receipt, "status", receipt["status"] if isinstance(receipt, dict) else 0))
        gas_used = int(getattr(receipt, "gasUsed", 0) or 0)
        raw_hash = getattr(receipt, "transactionHash", b"")
        tx_hex = raw_hash.to_0x_hex() if hasattr(raw_hash, "to_0x_hex") else Web3.to_hex(raw_hash)
        logger.info("Receipt status=%s gasUsed=%s tx=%s", status, gas_used, tx_hex)
        if status != 1 and not config.DRY_RUN:
            logger.error("Swap failed on-chain")
            return 1
        logger.info("buy_bot done")
        return 0
    except Exception:
        logger.exception("buy_bot crashed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
