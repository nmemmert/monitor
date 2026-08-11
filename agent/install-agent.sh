#!/bin/bash
# SkyWatch Linux Agent Installer
# Installs the agent as a systemd service on Ubuntu/Debian/RHEL/CentOS/Fedora
#
# Usage:
#   sudo bash install-agent.sh --server-url http://<host>:3001 [options]
#
# Options:
#   --server-url <URL>     SkyWatch server URL (required)
#   --interval <seconds>   Metrics report interval (default: 60)
#   --name <name>          Agent display name (default: hostname)
#   --uninstall            Remove the agent and all its files

set -e

AGENT_DIR="/opt/skywatch-agent"
CONFIG_FILE="/etc/skywatch-agent.conf"
SERVICE_FILE="/etc/systemd/system/skywatch-agent.service"
SCRIPT_NAME="skywatch-agent.sh"
SERVICE_NAME="skywatch-agent"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

usage() {
    cat << EOF
Usage: sudo bash install-agent.sh --server-url <URL> [options]

Options:
  --server-url <URL>        SkyWatch server URL  (required)
  --interval <secs>         How often to report metrics in seconds (default: 60)
  --name <name>             Agent name shown in dashboard (default: hostname)
  --registration-key <key>  Secret key required by the server to allow registration
  --uninstall               Stop, disable, and remove the agent

Examples:
  sudo bash install-agent.sh --server-url https://skywatch.necloud.us
  sudo bash install-agent.sh --server-url https://skywatch.necloud.us --interval 30 --name web-01
  sudo bash install-agent.sh --server-url https://skywatch.necloud.us --registration-key mySecret
  sudo bash install-agent.sh --uninstall
EOF
    exit 1
}

# ── Argument parsing ──────────────────────────────────────────────────────────
SKYWATCH_URL=""
INTERVAL=60
AGENT_NAME=""
REGISTRATION_KEY=""
UNINSTALL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server-url)        SKYWATCH_URL="${2:?'--server-url requires a value'}"; shift 2 ;;
        --interval)          INTERVAL="${2:?'--interval requires a value'}"; shift 2 ;;
        --name)              AGENT_NAME="${2:?'--name requires a value'}"; shift 2 ;;
        --registration-key)  REGISTRATION_KEY="${2:?'--registration-key requires a value'}"; shift 2 ;;
        --uninstall)         UNINSTALL=true; shift ;;
        -h|--help)           usage ;;
        *)                   error "Unknown option: $1"; usage ;;
    esac
done

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    die "This installer must be run as root. Try: sudo bash $0 $*"
fi

# ── Uninstall path ────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = true ]; then
    info "Uninstalling SkyWatch Agent..."
    systemctl stop "$SERVICE_NAME"  2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload 2>/dev/null || true
    rm -rf "$AGENT_DIR"
    rm -f "$CONFIG_FILE"
    rm -f /var/log/skywatch-agent.log
    ok "SkyWatch Agent removed."
    exit 0
fi

# ── Validate required args ────────────────────────────────────────────────────
[ -z "$SKYWATCH_URL" ] && usage

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║      SkyWatch Linux Agent Installer      ║"
echo "╚══════════════════════════════════════════╝"
echo ""
info "Server URL : $SKYWATCH_URL"
info "Interval   : ${INTERVAL}s"
info "Agent name : ${AGENT_NAME:-$(hostname -f 2>/dev/null || hostname)}"
[ -n "$REGISTRATION_KEY" ] && info "Reg. key   : (set)"
echo ""

# ── Dependency check ──────────────────────────────────────────────────────────
for cmd in curl awk df; do
    command -v "$cmd" &>/dev/null || die "Required command '$cmd' not found. Install it and retry."
done

if ! command -v systemctl &>/dev/null; then
    die "systemd not found. This installer requires a systemd-based Linux distro (Ubuntu 16.04+, Debian 9+, RHEL/CentOS 7+)."
fi

# ── Locate the agent script ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_SRC="$SCRIPT_DIR/$SCRIPT_NAME"

mkdir -p "$AGENT_DIR"

if [ -f "$SCRIPT_SRC" ]; then
    cp "$SCRIPT_SRC" "$AGENT_DIR/$SCRIPT_NAME"
    ok "Agent script copied from $SCRIPT_SRC"
else
    info "Downloading agent script from server..."
    if ! curl -fsSL "${SKYWATCH_URL}/api/agents/script" -o "$AGENT_DIR/$SCRIPT_NAME"; then
        die "Could not find $SCRIPT_NAME locally or download it from the server.\nPlace install-agent.sh and skywatch-agent.sh in the same directory."
    fi
    ok "Agent script downloaded."
fi

chmod +x "$AGENT_DIR/$SCRIPT_NAME"

# ── Write config ──────────────────────────────────────────────────────────────
cat > "$CONFIG_FILE" << CONF
# SkyWatch Agent configuration
SKYWATCH_URL="${SKYWATCH_URL}"
AGENT_TOKEN=""
REPORT_INTERVAL="${INTERVAL}"
AGENT_NAME="${AGENT_NAME:-$(hostname -f 2>/dev/null || hostname)}"
REGISTRATION_KEY="${REGISTRATION_KEY}"
CONF
chmod 600 "$CONFIG_FILE"
ok "Config written to $CONFIG_FILE"

# ── Create systemd unit ───────────────────────────────────────────────────────
cat > "$SERVICE_FILE" << UNIT
[Unit]
Description=SkyWatch System Metrics Agent
Documentation=https://github.com/nmemmert/monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash ${AGENT_DIR}/${SCRIPT_NAME}
Restart=always
RestartSec=30
Environment=CONFIG_FILE=${CONFIG_FILE}
Environment=LOG_FILE=/var/log/skywatch-agent.log
StandardOutput=journal
StandardError=journal
SyslogIdentifier=skywatch-agent

[Install]
WantedBy=multi-user.target
UNIT

ok "Systemd unit written to $SERVICE_FILE"

# ── Enable and start ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 2   # give it a moment to register

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         Agent installed and running!     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
ok "Service: $SERVICE_NAME"
ok "Config:  $CONFIG_FILE"
ok "Logs:    /var/log/skywatch-agent.log"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo "  sudo systemctl stop $SERVICE_NAME"
echo "  sudo bash $0 --uninstall"
echo ""
echo "The agent will appear in your SkyWatch dashboard under the Agents section."
echo ""

# ── Show live status ──────────────────────────────────────────────────────────
systemctl --no-pager status "$SERVICE_NAME" || true
