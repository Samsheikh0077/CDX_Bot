"""Shared helpers: web3, balances, Chainlink, logging, retries, tx send."""

from __future__ import annotations

import json
import logging
import os
import time
from functools import wraps
from logging.handlers import RotatingFileHandler
from types import SimpleNamespace
from typing import Any, Callable

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.types import TxParams, Wei

import config

os.makedirs(config.LOG_DIR, exist_ok=True)

CHAINLINK_ABI = [
    {
        "inputs": [],
        "name": "latestRoundData",
        "outputs": [
            {"name": "roundId", "type": "uint80"},
            {"name": "answer", "type": "int256"},
            {"name": "startedAt", "type": "uint256"},
            {"name": "updatedAt", "type": "uint256"},
            {"name": "answeredInRound", "type": "uint80"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def setup_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s")
    file_handler = RotatingFileHandler(
        os.path.join(config.LOG_DIR, f"{name}.log"),
        maxBytes=5_000_000,
        backupCount=3,
    )
    file_handler.setFormatter(fmt)
    stream = logging.StreamHandler()
    stream.setFormatter(fmt)
    logger.addHandler(file_handler)
    logger.addHandler(stream)
    logger.propagate = False
    return logger


def retry(times: int = 3, delay: float = 2) -> Callable:
    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last: Exception | None = None
            for attempt in range(times):
                try:
                    return fn(*args, **kwargs)
                except Exception as exc:  # noqa: BLE001
                    last = exc
                    sleep_for = delay * (2**attempt)
                    logging.getLogger("utils").warning(
                        "Retry %s/%s after error: %s (sleep %.1fs)",
                        attempt + 1,
                        times,
                        exc,
                        sleep_for,
                    )
                    time.sleep(sleep_for)
            assert last is not None
            raise last

        return wrapper

    return decorator


def get_web3() -> Web3:
    if not config.RPC_URL:
        raise RuntimeError("RPC_URL missing. Copy .env.example to .env.")
    w3 = Web3(Web3.HTTPProvider(config.RPC_URL, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise ConnectionError(f"RPC connect fail: {config.RPC_URL}")
    return w3


def get_account() -> LocalAccount:
    if not config.PRIVATE_KEY:
        raise RuntimeError("PRIVATE_KEY missing hai .env mein.")
    key = config.PRIVATE_KEY
    if not key.startswith("0x"):
        key = "0x" + key
    return Account.from_key(key)


def load_abi(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def get_eth_balance(w3: Web3, address: str) -> float:
    wei = w3.eth.get_balance(Web3.to_checksum_address(address))
    return float(w3.from_wei(wei, "ether"))


def get_token_balance(w3: Web3, token_addr: str, wallet: str) -> int:
    abi = load_abi(os.path.join(config.ABI_DIR, "erc20.json"))
    token = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=abi)
    return int(token.functions.balanceOf(Web3.to_checksum_address(wallet)).call())


def get_token_decimals(w3: Web3, token_addr: str) -> int:
    abi = load_abi(os.path.join(config.ABI_DIR, "erc20.json"))
    token = w3.eth.contract(address=Web3.to_checksum_address(token_addr), abi=abi)
    return int(token.functions.decimals().call())


@retry(times=config.RETRY_COUNT, delay=2)
def get_eth_price_usd(w3: Web3) -> float:
    feed = w3.eth.contract(address=config.CHAINLINK_ETH_USD, abi=CHAINLINK_ABI)
    round_data = feed.functions.latestRoundData().call()
    decimals = int(feed.functions.decimals().call())
    answer = int(round_data[1])
    price = answer / (10**decimals)
    if price <= 0:
        raise RuntimeError("Chainlink ETH/USD invalid")
    return float(price)


def usd_to_eth(usd: float, eth_price: float) -> float:
    if eth_price <= 0:
        raise ValueError("ETH price must be > 0")
    return float(usd) / float(eth_price)


def eth_to_usd(eth: float, eth_price: float) -> float:
    return float(eth) * float(eth_price)


def read_state() -> dict[str, Any]:
    if not os.path.exists(config.STATE_PATH):
        data = {"buy_index": 0, "sell_index": 0}
        write_state(data)
        return data
    with open(config.STATE_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def write_state(data: dict[str, Any]) -> None:
    tmp = config.STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    os.replace(tmp, config.STATE_PATH)


def next_index(state_key: str, list_len: int) -> int:
    if list_len <= 0:
        raise ValueError("list_len must be > 0")
    state = read_state()
    idx = int(state.get(state_key, 0)) % list_len
    state[state_key] = (idx + 1) % list_len
    write_state(state)
    return idx


def get_eip1559_fees(w3: Web3) -> tuple[int, int]:
    """Returns (maxFeePerGas, maxPriorityFeePerGas) in wei. Legacy fallback."""
    try:
        block = w3.eth.get_block("latest")
        base = int(block.get("baseFeePerGas") or 0)
        if base <= 0:
            raise RuntimeError("no base fee")
        try:
            prio = int(w3.eth.max_priority_fee)
        except Exception:
            prio = int(w3.to_wei(1, "gwei"))
        max_fee = base * 2 + prio
        return max_fee, prio
    except Exception:
        gas_price = int(w3.eth.gas_price)
        return gas_price, 0


def _tx_hash_hex(value: Any) -> str:
    if value is None:
        return "0x" + "00" * 32
    if isinstance(value, bytes):
        return "0x" + value.hex()
    text = str(value)
    return text if text.startswith("0x") else "0x" + text


def send_transaction(w3: Web3, account: LocalAccount, tx: TxParams, logger: logging.Logger | None = None) -> Any:
    log = logger or logging.getLogger("utils")
    if config.DRY_RUN:
        log.info("DRY_RUN=true — tx sign/send skip. Payload: %s", _safe_tx_log(tx))
        return SimpleNamespace(
            status=1,
            gasUsed=0,
            transactionHash=bytes(32),
            blockNumber=0,
        )

    signed = account.sign_transaction(tx)
    raw = signed.raw_transaction
    tx_hash = w3.eth.send_raw_transaction(raw)
    log.info("Broadcast tx %s", tx_hash.to_0x_hex() if hasattr(tx_hash, "to_0x_hex") else _tx_hash_hex(tx_hash))
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=config.RECEIPT_TIMEOUT)
    return receipt


def fill_tx(w3: Web3, account: LocalAccount, tx: dict[str, Any], gas: int) -> TxParams:
    nonce = w3.eth.get_transaction_count(account.address)
    max_fee, prio = get_eip1559_fees(w3)
    max_gwei = Web3.from_wei(max_fee, "gwei")
    built: dict[str, Any] = {
        **tx,
        "from": account.address,
        "nonce": nonce,
        "gas": gas,
        "chainId": w3.eth.chain_id,
    }
    if prio > 0:
        built["maxFeePerGas"] = Wei(max_fee)
        built["maxPriorityFeePerGas"] = Wei(prio)
    else:
        built["gasPrice"] = Wei(max_fee)
    built["_max_gwei"] = float(max_gwei)
    return built  # type: ignore[return-value]


def gas_over_cap(tx: dict[str, Any]) -> bool:
    gwei = float(tx.get("_max_gwei") or 0)
    return gwei > config.MAX_GAS_PRICE_GWEI


def strip_internal(tx: dict[str, Any]) -> TxParams:
    clean = {k: v for k, v in tx.items() if not str(k).startswith("_")}
    return clean  # type: ignore[return-value]


def _safe_tx_log(tx: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in tx.items():
        if key in {"data"} and isinstance(value, (bytes, str)) and len(str(value)) > 24:
            out[key] = str(value)[:18] + "…"
        else:
            out[key] = value if not isinstance(value, bytes) else "0x" + value.hex()
    return out
