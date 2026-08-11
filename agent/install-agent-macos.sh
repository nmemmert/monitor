#!/bin/bash
# SkyWatch macOS Agent Installer v1.0.0
# Installs the agent as a launchd daemon (runs at boot, requires sudo)
#
# Usage:
#   sudo bash install-agent-macos.sh --server-url https://skywatch.example.com
#
# Options:
#   --server-url <url>        SkyWatch server URL (required)
#   --interval <secs>         Reporting interval in seconds (default: 60)
#   --name <label>            Agent display name (default: hostname)
#   --registration-key <key>  Optional registration key
#   --uninstall               Remove the agent

set -e

PLIST_LABEL="us.necloud.skywatch-agent"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_LABEL}.plist"
AGENT_SCRIPT="/usr/local/bin/skywatch-agent-macos.sh"
CONFIG_FILE="/etc/skywatch-agent-macos.conf"
LOG_FILE="/var/log/skywatch-agent.log"

SERVER_URL=""
INTERVAL=60
AGENT_NAME="$(hostname -f 2>/dev/null || hostname)"
REGISTRATION_KEY=""
UNINSTALL=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --server-url)        SERVER_URL="$2"; shift 2 ;;
        --interval)          INTERVAL="$2";   shift 2 ;;
        --name)              AGENT_NAME="$2"; shift 2 ;;
        --registration-key)  REGISTRATION_KEY="$2"; shift 2 ;;
        --uninstall)         UNINSTALL=true;  shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

step() { echo "==> $*"; }
ok()   { echo "    OK: $*"; }

# ── Uninstall ──────────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = true ]; then
    step "Stopping and removing SkyWatch agent ..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH" "$AGENT_SCRIPT" "$CONFIG_FILE"
    ok "SkyWatch agent removed."
    ok "Log file kept at ${LOG_FILE} — remove manually if desired."
    exit 0
fi

# ── Require root ───────────────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This installer must be run as root: sudo bash $0 $*"
    exit 1
fi

if [ -z "$SERVER_URL" ]; then
    echo "ERROR: --server-url is required."
    echo "Usage: sudo bash install-agent-macos.sh --server-url https://skywatch.example.com"
    exit 1
fi

# ── Install ────────────────────────────────────────────────────────────────────
step "Downloading agent script from ${SERVER_URL} ..."
curl -fsSL "${SERVER_URL}/api/agents/script-macos" -o "$AGENT_SCRIPT"
chmod +x "$AGENT_SCRIPT"
ok "Agent script installed to ${AGENT_SCRIPT}"

step "Writing configuration ..."
cat > "$CONFIG_FILE" << CONF
SKYWATCH_URL="${SERVER_URL}"
AGENT_TOKEN=""
REPORT_INTERVAL="${INTERVAL}"
AGENT_NAME="${AGENT_NAME}"
REGISTRATION_KEY="${REGISTRATION_KEY}"
CONF
chmod 600 "$CONFIG_FILE"
ok "Config written to ${CONFIG_FILE}"

step "Installing launchd daemon ..."
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${AGENT_SCRIPT}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CONFIG_FILE</key>
        <string>${CONFIG_FILE}</string>
        <key>LOG_FILE</key>
        <string>${LOG_FILE}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
</dict>
</plist>
PLIST
chmod 644 "$PLIST_PATH"
ok "Daemon plist written to ${PLIST_PATH}"

step "Loading daemon ..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "✅ SkyWatch Agent installed and started!"
echo "   Logs:      tail -f ${LOG_FILE}"
echo "   Status:    launchctl list | grep skywatch"
echo "   Uninstall: sudo bash install-agent-macos.sh --uninstall"
echo ""
echo "The agent will register with ${SERVER_URL} and appear in your"
echo "SkyWatch dashboard within a minute."
