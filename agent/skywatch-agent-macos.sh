#!/bin/bash
# SkyWatch macOS Agent v1.0.0
# Collects system metrics and sends to SkyWatch monitoring server
#
# Requirements: macOS 10.15+, bash 3.2+, curl
# Run via launchd (see install-agent-macos.sh) or: bash skywatch-agent-macos.sh

VERSION="1.0.0"
CONFIG_FILE="${CONFIG_FILE:-/etc/skywatch-agent-macos.conf}"
LOG_FILE="${LOG_FILE:-/var/log/skywatch-agent.log}"

# Fall back to home dir if system paths aren't writable
if [ ! -w "$(dirname "$CONFIG_FILE")" ] 2>/dev/null; then
    CONFIG_FILE="$HOME/.skywatch-agent-macos.conf"
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

# CPU usage % — two samples from top, 1 second apart
get_cpu_percent() {
    local line idle
    line=$(top -l 2 -n 0 2>/dev/null | grep "^CPU usage:" | tail -1)
    # "CPU usage: 8.46% user, 11.45% sys, 80.08% idle"
    idle=$(echo "$line" | awk '{
        for (i = 1; i <= NF; i++) {
            if ($i ~ /idle/) {
                v = $(i - 1); gsub(/%/, "", v); print v; exit
            }
        }
    }')
    [ -z "$idle" ] && idle=0
    awk -v i="$idle" 'BEGIN { printf "%.1f", 100 - i }'
}

# Memory stats in MB — uses vm_stat + sysctl
get_memory() {
    local total_bytes vm_out page_size pages_free pages_inactive pages_spec

    total_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    vm_out=$(vm_stat 2>/dev/null)

    # Page size from vm_stat header (4096 on Intel, 16384 on Apple Silicon)
    page_size=$(echo "$vm_out" | awk '/page size of/ {
        for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/ && $(i+1) == "bytes") { print $i; exit }
    }')
    [ -z "$page_size" ] && page_size=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)

    pages_free=$(echo     "$vm_out" | awk '/^Pages free:/        { gsub(/\./, "", $NF); print $NF+0 }')
    pages_inactive=$(echo "$vm_out" | awk '/^Pages inactive:/    { gsub(/\./, "", $NF); print $NF+0 }')
    pages_spec=$(echo     "$vm_out" | awk '/^Pages speculative:/ { gsub(/\./, "", $NF); print $NF+0 }')

    awk -v total="$total_bytes" -v page="$page_size" \
        -v free="${pages_free:-0}" -v inact="${pages_inactive:-0}" -v spec="${pages_spec:-0}" \
    'BEGIN {
        total_mb = int(total / 1048576)
        avail_mb = int((free + inact + spec) * page / 1048576)
        used_mb  = total_mb - avail_mb
        if (used_mb < 0) used_mb = 0
        pct = (total_mb > 0) ? used_mb * 100.0 / total_mb : 0
        printf "%d %d %.1f", total_mb, used_mb, pct
    }'
}

# Disk info as JSON — real mounted volumes, skips macOS internal system volumes
get_disk_json() {
    df -P -k 2>/dev/null | tail -n +2 | awk '
        $6 ~ /^\/System\/Volumes\// { next }
        $6 ~ /^\/private\/var\/vm/  { next }
        NF >= 6 {
            pct = $5; sub(/%/, "", pct)
            mp = $6
            gsub(/\\/, "\\\\", mp); gsub(/"/, "\\\"", mp)
            if (c > 0) printf ","
            printf "{\"path\":\"%s\",\"total_mb\":%d,\"used_mb\":%d,\"percent\":%d}",
                mp, int($2/1024), int($3/1024), int(pct)
            c++
        }
        BEGIN { printf "[" }
        END   { printf "]" }
    '
}

# Cumulative network bytes — hardware-level rows from netstat -ib, no loopback
get_net_bytes() {
    netstat -ib 2>/dev/null | awk '
        /Name/ { next }
        /<Link#/ && !/^lo/ { recv += $7; sent += $10 }
        END { printf "%d %d", sent, recv }
    ' || echo "0 0"
}

# 1/5/15-min load averages from sysctl
get_load() {
    sysctl -n vm.loadavg 2>/dev/null \
        | awk '{ printf "%s %s %s", $2, $3, $4 }' \
        || echo "0.00 0.00 0.00"
}

# System uptime in seconds from boot time
get_uptime_seconds() {
    local boot_sec now_sec
    # kern.boottime: { sec = NNNN, usec = N }
    boot_sec=$(sysctl -n kern.boottime 2>/dev/null \
        | awk '{ for (i=1;i<=NF;i++) if ($i=="sec") { v=$(i+2); gsub(/[^0-9]/,"",v); print v; exit } }')
    now_sec=$(date +%s)
    if [ -n "$boot_sec" ] && [ "$boot_sec" -gt 0 ] 2>/dev/null; then
        echo $((now_sec - boot_sec))
    else
        echo 0
    fi
}

# Running process count
get_process_count() {
    ps -ax 2>/dev/null | tail -n +2 | wc -l | tr -d ' \n'
}

# Primary non-loopback IPv4
get_ip_address() {
    local iface
    iface=$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')
    if [ -n "$iface" ]; then
        ipconfig getifaddr "$iface" 2>/dev/null \
            || ifconfig "$iface" 2>/dev/null | awk '/inet / { print $2; exit }'
    fi
}

# macOS version string
get_os_info() {
    local name ver
    name=$(sw_vers -productName    2>/dev/null || echo "macOS")
    ver=$(sw_vers  -productVersion 2>/dev/null || echo "")
    echo "${name} ${ver}"
}

# Register with server; saves token to config on success
register_agent() {
    local name="${AGENT_NAME:-$(hostname -f 2>/dev/null || hostname)}"
    local hostname_val
    hostname_val=$(hostname -f 2>/dev/null || hostname)
    local ip
    ip=$(get_ip_address || echo "")
    local os
    os=$(get_os_info)

    local esc_name esc_host esc_os
    esc_name="${name//\"/\\\"}"
    esc_host="${hostname_val//\"/\\\"}"
    esc_os="${os//\"/\\\"}"

    log "Registering agent '${name}' with ${SKYWATCH_URL} ..."

    local -a curl_args
    curl_args=(-sf -m 30 -X POST -H 'Content-Type: application/json')
    [ -n "${REGISTRATION_KEY:-}" ] && curl_args+=(-H "X-Registration-Key: ${REGISTRATION_KEY}")
    curl_args+=(-d "{\"name\":\"${esc_name}\",\"hostname\":\"${esc_host}\",\"ip_address\":\"${ip}\",\"os_info\":\"${esc_os}\"}")
    curl_args+=("${SKYWATCH_URL}/api/agents/register")

    local response
    response=$(curl "${curl_args[@]}" 2>&1) || {
        log "ERROR: Could not reach ${SKYWATCH_URL}"
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

# Collect and POST metrics
report_metrics() {
    local cpu
    cpu=$(get_cpu_percent)   # includes ~1s sleep inside top

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

    cpu="${cpu:-0.0}"; mem_total="${mem_total:-0}"; mem_used="${mem_used:-0}"
    mem_percent="${mem_percent:-0.0}"; disk="${disk:-[]}"; net_sent="${net_sent:-0}"
    net_recv="${net_recv:-0}"; load1="${load1:-0.00}"; load5="${load5:-0.00}"
    load15="${load15:-0.00}"; uptime_secs="${uptime_secs:-0}"; procs="${procs:-0}"

    local payload
    payload=$(printf \
        '{"cpu_percent":%s,"mem_total":%d,"mem_used":%d,"mem_percent":%s,"disk":%s,"load_1":%s,"load_5":%s,"load_15":%s,"uptime_seconds":%d,"process_count":%d,"net_bytes_sent":%s,"net_bytes_recv":%s,"ip_address":"%s"}' \
        "$cpu" "$mem_total" "$mem_used" "$mem_percent" \
        "$disk" "$load1" "$load5" "$load15" \
        "$uptime_secs" "$procs" "$net_sent" "$net_recv" "${ip}")

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

main() {
    load_config

    if [ -z "${SKYWATCH_URL:-}" ]; then
        echo "ERROR: SKYWATCH_URL is not set."
        echo "Create ${CONFIG_FILE} or use the installer:"
        echo "  sudo bash install-agent-macos.sh --server-url https://<your-server>"
        exit 1
    fi

    if [ -z "${AGENT_TOKEN:-}" ]; then
        if ! register_agent; then
            log "Retrying registration in 60 s..."
            sleep 60
            register_agent || exit 1
        fi
    fi

    local interval="${REPORT_INTERVAL:-60}"
    log "SkyWatch Agent v${VERSION} started (macOS) — server=${SKYWATCH_URL}  interval=${interval}s"

    while true; do
        report_metrics
        local sleep_time=$(( interval - 1 ))
        [ "$sleep_time" -lt 1 ] && sleep_time=1
        sleep "$sleep_time"
    done
}

main "$@"
