"""Hourly CDX sell: CDX -> ETH on Uniswap V2. Cron: 30 * * * *"""

from __future__ import annotations

import sys
import time

from web3 import Web3

import config
from utils import (
    fill_tx,
    gas_over_cap,
    get_account,
    get_eth_price_usd,
    get_token_balance,
    get_token_decimals,
    get_web3,
    load_abi,
    next_index,
    send_transaction,
    setup_logger,
    strip_internal,
    usd_to_eth,
)


def main() -> int:
    logger = setup_logger("sell")
    logger.info("=== sell_bot start DRY_RUN=%s ===", config.DRY_RUN)
    try:
        w3 = get_web3()
        account = get_account()
        wallet = config.WALLET_ADDRESS

        router_abi = load_abi(f"{config.ABI_DIR}/uniswap_v2_router.json")
        erc20_abi = load_abi(f"{config.ABI_DIR}/erc20.json")
        router = w3.eth.contract(address=config.UNISWAP_V2_ROUTER, abi=router_abi)
        token = w3.eth.contract(address=config.CDX_TOKEN, abi=erc20_abi)

        eth_price = get_eth_price_usd(w3)
        logger.info("ETH/USD (Chainlink) = %.4f", eth_price)

        decimals = get_token_decimals(w3, config.CDX_TOKEN)
        balance = get_token_balance(w3, config.CDX_TOKEN, wallet)
        logger.info("CDX balance raw=%s decimals=%s", balance, decimals)
        if balance <= 0:
            logger.warning("CDX balance 0. Skip sell.")
            return 0

        idx = next_index("sell_index", len(config.SELL_AMOUNTS_USD))
        usd = config.SELL_AMOUNTS_USD[idx]
        target_eth = usd_to_eth(usd, eth_price)
        target_eth_wei = int(w3.to_wei(target_eth, "ether"))
        logger.info("Clip #%s  $%s  ~ %.8f ETH", idx, usd, target_eth)

        path = [config.CDX_TOKEN, config.WETH]
        probe = 10**decimals
        probe_out = router.functions.getAmountsOut(probe, path).call()
        spot_eth_wei = int(probe_out[-1])
        if spot_eth_wei <= 0:
            logger.error("Spot rate 0 — pair missing ya liquidity nahi")
            return 1
        cdx_amount = (target_eth_wei * probe) // spot_eth_wei
        if cdx_amount <= 0:
            cdx_amount = balance
        if cdx_amount > balance:
            logger.info("Cap CDX amount %s -> balance %s", cdx_amount, balance)
            cdx_amount = balance

        amounts = router.functions.getAmountsOut(cdx_amount, path).call()
        eth_out = int(amounts[-1])
        amount_out_min = int(eth_out * (1 - config.SLIPPAGE))
        deadline = int(time.time()) + config.DEADLINE_SECONDS
        logger.info(
            "Selling CDX=%s  expected ETH wei=%s  amountOutMin=%s",
            cdx_amount,
            eth_out,
            amount_out_min,
        )

        allowance = int(token.functions.allowance(wallet, config.UNISWAP_V2_ROUTER).call())
        if allowance < cdx_amount:
            logger.info(
                "Allowance %s < need %s — sending approve(MAX_UINT256)",
                allowance,
                cdx_amount,
            )
            approve_fn = token.functions.approve(config.UNISWAP_V2_ROUTER, config.MAX_UINT256)
            approve_tx = fill_tx(
                w3,
                account,
                approve_fn.build_transaction({"from": account.address}),
                gas=config.GAS_LIMIT_APPROVE,
            )
            if gas_over_cap(approve_tx):
                logger.warning("Approve skipped, gas cap.")
                return 0
            receipt = send_transaction(w3, account, strip_internal(approve_tx), logger)
            status = int(getattr(receipt, "status", 1))
            logger.info("Approve receipt status=%s", status)
            if status != 1 and not config.DRY_RUN:
                logger.error("Approve failed")
                return 1

        fn = router.functions.swapExactTokensForETH(
            cdx_amount,
            amount_out_min,
            path,
            wallet,
            deadline,
        )
        tx = fill_tx(
            w3,
            account,
            fn.build_transaction({"from": account.address}),
            gas=config.GAS_LIMIT_SWAP,
        )
        if gas_over_cap(tx):
            logger.warning(
                "Gas cap hit (%.2f gwei > %s). Skip.",
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
            logger.error("Sell swap failed on-chain")
            return 1
        logger.info("sell_bot done")
        return 0
    except Exception:
        logger.exception("sell_bot crashed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
