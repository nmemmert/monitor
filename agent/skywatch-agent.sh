#!/bin/bash
# SkyWatch Linux Agent v1.0.0
# Collects system metrics and sends to SkyWatch monitoring server
#
# Metrics: CPU %, Memory, Disk, Network I/O, Load Average, Process Count
# Requirements: bash 4+, curl, awk, df, /proc filesystem (standard Linux)
#
# Usage:
#   Configured via CONFIG_FILE (default /etc/skywatch-agent.conf)
#   Run via systemd (see install-agent.sh) or: bash skywatch-agent.sh

VERSION="1.0.0"
CONFIG_FILE="${CONFIG_FILE:-/etc/skywatch-agent.conf}"
LOG_FILE="${LOG_FILE:-/var/log/skywatch-agent.log}"

# Fall back to home dir if system paths aren't writable
if [ ! -w "$(dirname "$CONFIG_FILE")" ] 2>/dev/null; then
    CONFIG_FILE="$HOME/.skywatch-agent.conf"
    LOG_FILE="$HOME/.skywatch-agent.log"
fi

log() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "")
    local msg="[$ts] $*"
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
    echo "$msg"
}

load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        # shellcheck disable=SC1090
        source "$CONFIG_FILE"
    fi
}

save_config() {
    cat > "$CONFIG_FILE" << CONF
SKYWATCH_URL="${SKYWATCH_URL:-}"
AGENT_TOKEN="${AGENT_TOKEN:-}"
REPORT_INTERVAL="${REPORT_INTERVAL:-60}"
AGENT_NAME="${AGENT_NAME:-}"
REGISTRATION_KEY="${REGISTRATION_KEY:-}"
CONF
    chmod 600 "$CONFIG_FILE" 2>/dev/null || true
}

# CPU usage % — reads /proc/stat twice 1 second apart (that 1s is intentional)
get_cpu_percent() {
    local s1 s2
    s1=$(grep '^cpu ' /proc/stat 2>/dev/null) || { echo "0.0"; return; }
    sleep 1
    s2=$(grep '^cpu ' /proc/stat 2>/dev/null) || { echo "0.0"; return; }
    awk -v s1="$s1" -v s2="$s2" 'BEGIN {
        n = split(s1, a)
        split(s2, b)
        t1 = 0; t2 = 0
        for (i = 2; i <= n; i++) { t1 += a[i]; t2 += b[i] }
        # idle + iowait (indices 5 and 6 in the array, which is index 4+5 in /proc/stat)
        idle1 = a[5] + a[6]
        idle2 = b[5] + b[6]
        dt = t2 - t1
        di = idle2 - idle1
        if (dt <= 0) { printf "0.0"; exit }
        printf "%.1f", (dt - di) * 100 / dt
    }'
}

# Memory stats in MB
get_memory() {
    awk '
        /^MemTotal:/    { total = int($2 / 1024) }
        /^MemAvailable:/{ avail = int($2 / 1024) }
        END {
            used = total - avail
            pct  = (total > 0) ? used * 100.0 / total : 0
            printf "%d %d %.1f", total, used, pct
        }
    ' /proc/meminfo 2>/dev/null || echo "0 0 0.0"
}

# Disk info as a JSON array — real block devices only, no tmpfs/overlay
get_disk_json() {
    df -P -k \
        -x tmpfs -x devtmpfs -x squashfs -x overlay \
        2>/dev/null \
    | tail -n +2 \
    | grep '^/' \
    | awk '
        BEGIN { printf "["; c = 0 }
        {
            sub(/%/, "", $5)
            mp = $6
            # JSON-escape the mount path
            gsub(/\\/, "\\\\", mp)
            gsub(/"/, "\\\"", mp)
            if (c > 0) printf ","
            printf "{\"path\":\"%s\",\"total_mb\":%d,\"used_mb\":%d,\"percent\":%d}",
                mp, int($2 / 1024), int($3 / 1024), $5
            c++
        }
        END { printf "]" }
    '
}

# Cumulative network bytes since boot (all interfaces except loopback)
get_net_bytes() {
    awk '
        /:/ && !/lo:/ {
            split($0, parts, ":")
            split(parts[2], f)
            recv += f[1]   # receive bytes
            sent += f[9]   # transmit bytes
        }
        END { printf "%d %d", sent, recv }
    ' /proc/net/dev 2>/dev/null || echo "0 0"
}

# 1/5/15-minute load averages
get_load() {
    awk '{ printf "%s %s %s", $1, $2, $3 }' /proc/loadavg 2>/dev/null || echo "0.00 0.00 0.00"
}

# System uptime in whole seconds
get_uptime_seconds() {
    awk '{ printf "%d", $1 }' /proc/uptime 2>/dev/null || echo "0"
}

# Number of running processes
get_process_count() {
    ls -d /proc/[0-9]* 2>/dev/null | wc -l | tr -d ' \n'
}

# Primary non-loopback IPv4 address
get_ip_address() {
    if command -v ip &>/dev/null; then
        ip -4 route get 1.1.1.1 2>/dev/null \
            | awk '/src/ { for(i=1;i<=NF;i++) if($i=="src"){ print $(i+1); exit } }'
    elif command -v hostname &>/dev/null; then
        hostname -I 2>/dev/null | awk '{print $1}'
    fi
}

# OS description string
get_os_info() {
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        echo "${PRETTY_NAME:-${NAME:-Linux}}"
    else
        uname -sr
    fi
}

# Register this host with the server; saves token to config on success
register_agent() {
    local name="${AGENT_NAME:-$(hostname -f 2>/dev/null || hostname)}"
    local hostname_val
    hostname_val=$(hostname -f 2>/dev/null || hostname)
    local ip
    ip=$(get_ip_address || echo "")
    local os
    os=$(get_os_info)

    # Sanitize values for JSON string embedding
    local esc_name esc_host esc_os
    esc_name="${name//\"/\\\"}"
    esc_host="${hostname_val//\"/\\\"}"
    esc_os="${os//\"/\\\"}"

    log "Registering agent '${name}' with ${SKYWATCH_URL} ..."

    # Build curl args as an array so we can conditionally add the registration key header
    local -a curl_args
    curl_args=(-sf -m 30 -X POST -H 'Content-Type: application/json')
    [ -n "${REGISTRATION_KEY:-}" ] && curl_args+=(-H "X-Registration-Key: ${REGISTRATION_KEY}")
    curl_args+=(-d "{\"name\":\"${esc_name}\",\"hostname\":\"${esc_host}\",\"ip_address\":\"${ip}\",\"os_info\":\"${esc_os}\"}")
    curl_args+=("${SKYWATCH_URL}/api/agents/register")

    local response
    response=$(curl "${curl_args[@]}" 2>&1) || {
        log "ERROR: Could not reach ${SKYWATCH_URL} during registration"
        return 1
    }

    local token
    token=$(echo "$response" | grep -o '"token":"[^"]*"' | sed 's/"token":"//; s/"$//')

    if [ -z "$token" ]; then
        log "ERROR: Registration failed. Server said: ${response}"
        return 1
    fi

    AGENT_TOKEN="$token"
    save_config
    log "Registered. Token stored in ${CONFIG_FILE}"
}

# Collect all metrics and POST to /api/agents/report
report_metrics() {
    local cpu
    cpu=$(get_cpu_percent)   # includes built-in 1 s sleep

    local mem_total mem_used mem_percent
    read -r mem_total mem_used mem_percent <<< "$(get_memory)"

    local disk
    disk=$(get_disk_json)

    local net_sent net_recv
    read -r net_sent net_recv <<< "$(get_net_bytes)"

    local load1 load5 load15
    read -r load1 load5 load15 <<< "$(get_load)"

    local uptime_secs
    uptime_secs=$(get_uptime_seconds)

    local procs
    procs=$(get_process_count)

    local ip
    ip=$(get_ip_address || echo "")

    # Fallbacks so we always produce valid JSON
    cpu="${cpu:-0.0}"
    mem_total="${mem_total:-0}"
    mem_used="${mem_used:-0}"
    mem_percent="${mem_percent:-0.0}"
    disk="${disk:-[]}"
    net_sent="${net_sent:-0}"
    net_recv="${net_recv:-0}"
    load1="${load1:-0.00}"
    load5="${load5:-0.00}"
    load15="${load15:-0.00}"
    uptime_secs="${uptime_secs:-0}"
    procs="${procs:-0}"

    local payload
    payload=$(printf \
        '{"cpu_percent":%s,"mem_total":%d,"mem_used":%d,"mem_percent":%s,"disk":%s,"load_1":%s,"load_5":%s,"load_15":%s,"uptime_seconds":%d,"process_count":%d,"net_bytes_sent":%s,"net_bytes_recv":%s,"ip_address":"%s"}' \
        "$cpu" "$mem_total" "$mem_used" "$mem_percent" \
        "$disk" "$load1" "$load5" "$load15" \
        "$uptime_secs" "$procs" \
        "$net_sent" "$net_recv" \
        "${ip}")

    local response
    response=$(curl -sf -m 15 \
        -X POST \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${AGENT_TOKEN}" \
        -d "$payload" \
        "${SKYWATCH_URL}/api/agents/report" 2>&1) || {
        log "WARNING: Failed to send metrics (network error)"
        return 0
    }

    if echo "$response" | grep -q '"ok":true'; then
        log "OK  cpu=${cpu}%  mem=${mem_used}/${mem_total}MB  load=${load1}"
    else
        log "WARNING: Server rejected metrics: ${response}"
    fi
}

# Poll for and execute one pending command from the server
poll_commands() {
    local resp http_code
    resp=$(curl -sf -m 10 \
        -H "Authorization: Bearer ${AGENT_TOKEN}" \
        -w '\n__HTTP_CODE__%{http_code}' \
        "${SKYWATCH_URL}/api/agents/commands/pending" 2>/dev/null) || return 0

    http_code=$(echo "$resp" | grep -o '__HTTP_CODE__[0-9]*' | tail -1 | grep -o '[0-9]*')
    resp=$(echo "$resp" | sed '/__HTTP_CODE__/d')

    # 204 = no pending commands
    [ "$http_code" = "204" ] && return 0
    [ "$http_code" != "200" ] && return 0

    local cmd_id cmd_str
    cmd_id=$(echo "$resp" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
    # Extract command value (handles escaped quotes)
    cmd_str=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command',''))" 2>/dev/null \
        || echo "$resp" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')

    [ -z "$cmd_id" ] || [ -z "$cmd_str" ] && return 0

    log "Running command #${cmd_id}: ${cmd_str}"

    # Execute with 60 s timeout, capture output, cap at 128 KB
    local tmp_out exit_code
    tmp_out=$(mktemp)
    timeout 60 bash -c "$cmd_str" > "$tmp_out" 2>&1
    exit_code=$?

    # Truncate to 128 KB
    truncate -s -"$(( $(wc -c < "$tmp_out") > 131072 ? $(wc -c < "$tmp_out") - 131072 : 0 ))" "$tmp_out" 2>/dev/null || true

    # Build JSON payload via python (handles all escaping correctly)
    local tmp_json
    tmp_json=$(mktemp)
    python3 - "$tmp_out" "$exit_code" > "$tmp_json" 2>/dev/null << 'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    output = f.read(131072)
print(json.dumps({"output": output, "exit_code": int(sys.argv[2])}))
PYEOF

    curl -sf -m 15 -X POST \
        -H "Authorization: Bearer ${AGENT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "@${tmp_json}" \
        "${SKYWATCH_URL}/api/agents/commands/${cmd_id}/result" >/dev/null 2>&1 || true

    rm -f "$tmp_out" "$tmp_json"
}

main() {
    load_config

    if [ -z "${SKYWATCH_URL:-}" ]; then
        echo "ERROR: SKYWATCH_URL is not set."
        echo ""
        echo "Create ${CONFIG_FILE} containing:"
        echo "  SKYWATCH_URL=\"http://<your-server>:3001\""
        echo ""
        echo "Or use the installer:"
        echo "  sudo bash install-agent.sh --server-url http://<your-server>:3001"
        exit 1
    fi

    # Register on first run (no token stored yet)
    if [ -z "${AGENT_TOKEN:-}" ]; then
        if ! register_agent; then
            log "Retrying registration in 60 s..."
            sleep 60
            register_agent || exit 1
        fi
    fi

    local interval="${REPORT_INTERVAL:-60}"
    log "SkyWatch Agent v${VERSION} started — server=${SKYWATCH_URL}  interval=${interval}s"

    while true; do
        report_metrics
        poll_commands
        # get_cpu_percent already consumed ~1 s; subtract it from the sleep
        local sleep_time=$(( interval - 1 ))
        [ "$sleep_time" -lt 1 ] && sleep_time=1
        sleep "$sleep_time"
    done
}

main "$@"
