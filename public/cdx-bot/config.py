"""CDX bot config. Constants + .env load. Address validation on import."""

from __future__ import annotations

import os
import stat
import warnings

from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

UNISWAP_V2_ROUTER = Web3.to_checksum_address("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D")
WETH = Web3.to_checksum_address("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")
CHAINLINK_ETH_USD = Web3.to_checksum_address("0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419")

SLIPPAGE = 0.05
GAS_LIMIT_SWAP = 300000
GAS_LIMIT_APPROVE = 100000
MAX_GAS_PRICE_GWEI = 50
RETRY_COUNT = 3
RECEIPT_TIMEOUT = 180
BUY_AMOUNTS_USD = [10, 5, 20]
SELL_AMOUNTS_USD = [10, 5, 20]
GAS_BUFFER_ETH = 0.005
DEADLINE_SECONDS = 600
MAX_UINT256 = 2**256 - 1

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ABI_DIR = os.path.join(BASE_DIR, "abis")
STATE_PATH = os.path.join(BASE_DIR, "state.json")
LOG_DIR = os.path.join(BASE_DIR, "logs")
ENV_PATH = os.path.join(BASE_DIR, ".env")


def _as_bool(raw: str | None, default: bool = True) -> bool:
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _require_address(value: str, label: str) -> str:
    if not value or not Web3.is_address(value):
        raise ValueError(f"Invalid {label}: {value!r}")
    return Web3.to_checksum_address(value)


def _warn_env_permissions() -> None:
    if not os.path.exists(ENV_PATH):
        return
    mode = os.stat(ENV_PATH).st_mode
    if mode & (stat.S_IROTH | stat.S_IWOTH | stat.S_IXOTH):
        warnings.warn(
            ".env world-readable hai. VPS par `chmod 600 .env` chalao.",
            UserWarning,
            stacklevel=2,
        )


_warn_env_permissions()

PRIVATE_KEY = (os.getenv("PRIVATE_KEY") or "").strip()
RPC_URL = (os.getenv("RPC_URL") or "").strip()
WALLET_ADDRESS = _require_address(
    os.getenv("WALLET_ADDRESS") or "0x0000000000000000000000000000000000000001",
    "WALLET_ADDRESS",
)
CDX_TOKEN = _require_address(
    os.getenv("CDX_TOKEN_ADDRESS") or "0x27DdDb492c9e593472D28722ED762c04f3d7221f",
    "CDX_TOKEN_ADDRESS",
)
DRY_RUN = _as_bool(os.getenv("DRY_RUN"), default=True)

for _label, _addr in (
    ("UNISWAP_V2_ROUTER", UNISWAP_V2_ROUTER),
    ("WETH", WETH),
    ("CDX_TOKEN", CDX_TOKEN),
    ("CHAINLINK_ETH_USD", CHAINLINK_ETH_USD),
    ("WALLET_ADDRESS", WALLET_ADDRESS),
):
    if not Web3.is_address(_addr):
        raise ValueError(f"Invalid {_label}: {_addr}")
