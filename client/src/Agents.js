import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import './Agents.css';

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes == null) return '—';
  const gb = bytes / 1073741824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1048576;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtUptime(secs) {
  if (!secs) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtLoad(v) {
  return v != null ? Number(v).toFixed(2) : '—';
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 3 * 60 * 1000;
}

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Gauge bar ─────────────────────────────────────────────────────────────────

function Gauge({ value, label }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#14b8a6';
  return (
    <div className="ag-gauge">
      <div className="ag-gauge-row">
        <span className="ag-gauge-label" title={label}>{label}</span>
        <span className="ag-gauge-val">{pct.toFixed(1)}%</span>
      </div>
      <div className="ag-gauge-track">
        <div className="ag-gauge-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ── Copy-to-clipboard command line ────────────────────────────────────────────

function CopyCmd({ cmd }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // fallback for older browsers
      const el = document.createElement('textarea');
      el.value = cmd;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="ag-cmd-row">
      <code className="ag-cmd">{cmd}</code>
      <button
        className={`ag-copy-btn${copied ? ' copied' : ''}`}
        onClick={copy}
        title="Copy to clipboard"
      >
        {copied ? '✓' : '⎘'}
      </button>
    </div>
  );
}

// ── Platform-specific install steps ──────────────────────────────────────────

function LinuxSteps({ serverUrl }) {
  return (
    <>
      <p className="ag-install-note">
        Ubuntu 16.04+ / Debian 9+ / RHEL 7+. Runs as a systemd service.
      </p>
      <div className="ag-install-steps">
        <div className="ag-step">
          <span className="ag-step-num">1</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Download the scripts</div>
            <CopyCmd cmd={`curl -fsSL ${serverUrl}/api/agents/script    -o skywatch-agent.sh`} />
            <CopyCmd cmd={`curl -fsSL ${serverUrl}/api/agents/installer  -o install-agent.sh`} />
          </div>
        </div>
        <div className="ag-step">
          <span className="ag-step-num">2</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Run the installer as root</div>
            <CopyCmd cmd={`sudo bash install-agent.sh --server-url ${serverUrl}`} />
          </div>
        </div>
      </div>
      <p className="ag-install-note ag-install-note-sm">
        Optional: <code>--interval&nbsp;&lt;secs&gt;</code>, <code>--name&nbsp;&lt;label&gt;</code>,{' '}
        <code>--registration-key&nbsp;&lt;key&gt;</code>.
        Remove: <code>sudo bash install-agent.sh --uninstall</code>
      </p>
    </>
  );
}

function MacosSteps({ serverUrl }) {
  return (
    <>
      <p className="ag-install-note">
        macOS 10.15+ (Intel &amp; Apple Silicon). Runs as a launchd system daemon.
      </p>
      <div className="ag-install-steps">
        <div className="ag-step">
          <span className="ag-step-num">1</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Download the scripts</div>
            <CopyCmd cmd={`curl -fsSL ${serverUrl}/api/agents/script-macos    -o skywatch-agent-macos.sh`} />
            <CopyCmd cmd={`curl -fsSL ${serverUrl}/api/agents/installer-macos  -o install-agent-macos.sh`} />
          </div>
        </div>
        <div className="ag-step">
          <span className="ag-step-num">2</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Run the installer as root</div>
            <CopyCmd cmd={`sudo bash install-agent-macos.sh --server-url ${serverUrl}`} />
          </div>
        </div>
      </div>
      <p className="ag-install-note ag-install-note-sm">
        Optional: <code>--interval&nbsp;&lt;secs&gt;</code>, <code>--name&nbsp;&lt;label&gt;</code>,{' '}
        <code>--registration-key&nbsp;&lt;key&gt;</code>.
        Remove: <code>sudo bash install-agent-macos.sh --uninstall</code>
      </p>
    </>
  );
}

function WindowsSteps({ serverUrl }) {
  return (
    <>
      <p className="ag-install-note">
        Windows 10 / 11 / Server 2019+. Runs via Task Scheduler as SYSTEM.
        Open <strong>PowerShell as Administrator</strong> and run:
      </p>
      <div className="ag-install-steps">
        <div className="ag-step">
          <span className="ag-step-num">1</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Download the installer</div>
            <CopyCmd cmd={`Invoke-WebRequest "${serverUrl}/api/agents/installer-windows" -OutFile install-agent-windows.ps1`} />
          </div>
        </div>
        <div className="ag-step">
          <span className="ag-step-num">2</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Run the installer</div>
            <CopyCmd cmd={`.\\install-agent-windows.ps1 -ServerUrl "${serverUrl}"`} />
          </div>
        </div>
      </div>
      <p className="ag-install-note ag-install-note-sm">
        Optional: <code>-Interval&nbsp;&lt;secs&gt;</code>, <code>-AgentName&nbsp;&lt;label&gt;</code>,{' '}
        <code>-RegistrationKey&nbsp;&lt;key&gt;</code>.
        Remove: <code>.\\install-agent-windows.ps1&nbsp;-Uninstall</code>
      </p>
    </>
  );
}

// ── Install instructions panel ────────────────────────────────────────────────

const PLATFORMS = [
  { id: 'linux',   label: '🐧 Linux'   },
  { id: 'macos',   label: '🍎 macOS'   },
  { id: 'windows', label: '🪟 Windows' },
];

function InstallPanel({ serverUrl }) {
  const [platform, setPlatform] = useState('linux');

  return (
    <div className="ag-install-panel">
      <h3 className="ag-install-title">Install agent on a host</h3>

      <div className="ag-platform-tabs">
        {PLATFORMS.map(p => (
          <button
            key={p.id}
            className={`ag-platform-tab${platform === p.id ? ' ag-platform-tab-active' : ''}`}
            onClick={() => setPlatform(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {platform === 'linux'   && <LinuxSteps   serverUrl={serverUrl} />}
      {platform === 'macos'   && <MacosSteps   serverUrl={serverUrl} />}
      {platform === 'windows' && <WindowsSteps serverUrl={serverUrl} />}
    </div>
  );
}

// ── Command terminal panel ────────────────────────────────────────────────────

function CommandTerminal({ agentId, agentName }) {
  const [commands, setCommands] = useState([]);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const [expanded, setExpanded] = useState({});
  const pollRef = useRef(null);

  const fetchCommands = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/agents/${agentId}/commands`);
      setCommands(data.commands || []);
    } catch (_) {}
  }, [agentId]);

  useEffect(() => {
    fetchCommands();
    pollRef.current = setInterval(fetchCommands, 4000);
    return () => clearInterval(pollRef.current);
  }, [fetchCommands]);

  const send = async () => {
    const cmd = input.trim();
    if (!cmd || sending) return;
    setSending(true);
    try {
      await axios.post(`/api/agents/${agentId}/commands`, { command: cmd });
      setInput('');
      fetchCommands();
    } catch (_) {}
    setSending(false);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const statusIcon = (s) => s === 'completed' ? '✓' : s === 'failed' ? '✗' : s === 'running' ? '↻' : '…';
  const statusClass = (s) => `ag-cmd-status ag-cmd-status-${s}`;

  return (
    <div className="ag-terminal">
      <div className="ag-terminal-title">Terminal — {agentName}</div>

      <div className="ag-terminal-input-row">
        <span className="ag-terminal-prompt">$</span>
        <input
          className="ag-terminal-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Enter command…"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="ag-terminal-run"
          onClick={send}
          disabled={!input.trim() || sending}
        >
          {sending ? '…' : 'Run'}
        </button>
      </div>

      <div className="ag-terminal-history">
        {commands.length === 0 && (
          <div className="ag-terminal-empty">No commands yet.</div>
        )}
        {commands.map(cmd => (
          <div key={cmd.id} className="ag-terminal-entry">
            <div className="ag-terminal-entry-head" onClick={() => cmd.output && toggleExpand(cmd.id)}>
              <span className={statusClass(cmd.status)}>{statusIcon(cmd.status)}</span>
              <code className="ag-terminal-entry-cmd">{cmd.command}</code>
              <span className="ag-terminal-entry-time">{timeAgo(cmd.created_at)}</span>
              {cmd.output && (
                <span className="ag-terminal-expand">{expanded[cmd.id] ? '▲' : '▼'}</span>
              )}
            </div>
            {expanded[cmd.id] && cmd.output && (
              <pre className="ag-terminal-output">{cmd.output}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Single agent card ─────────────────────────────────────────────────────────

function AgentCard({ agent, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const online = isOnline(agent.last_seen_at);
  const topDisks = (agent.disk || []).slice(0, 3);

  return (
    <div className={`ag-card ${online ? 'ag-online' : 'ag-offline'}`}>

      {/* ── Header row ── */}
      <div className="ag-card-head">
        <div className="ag-card-identity">
          <span className={`ag-dot ${online ? 'ag-dot-on' : 'ag-dot-off'}`} />
          <div style={{ minWidth: 0 }}>
            <div className="ag-name" title={agent.name}>{agent.name}</div>
            <div className="ag-sub" title={`${agent.hostname} · ${agent.ip_address || '?'}`}>
              {agent.hostname} · {agent.ip_address || '?'}
            </div>
          </div>
        </div>

        <div className="ag-card-actions">
          <button
            className={`ag-btn ag-btn-terminal${showTerminal ? ' ag-btn-terminal-active' : ''}`}
            onClick={() => setShowTerminal(v => !v)}
            title="Open terminal"
          >&gt;_</button>
          {confirmDel ? (
            <>
              <button className="ag-btn ag-btn-danger" onClick={() => onDelete(agent.id)}>Delete</button>
              <button className="ag-btn ag-btn-cancel" onClick={() => setConfirmDel(false)}>Cancel</button>
            </>
          ) : (
            <button
              className="ag-btn ag-btn-ghost"
              onClick={() => setConfirmDel(true)}
              title="Remove agent"
            >✕</button>
          )}
        </div>
      </div>

      {/* ── OS + status ── */}
      <div className="ag-meta">
        <span className="ag-os-tag" title={agent.os_info}>{agent.os_info || 'Linux'}</span>
        <span className={`ag-status-text ${online ? 'ag-status-on' : 'ag-status-off'}`}>
          {online ? '● Online' : `Last seen ${timeAgo(agent.last_seen_at)}`}
        </span>
      </div>

      {/* ── Metrics ── */}
      {agent.cpu_percent != null ? (
        <>
          <div className="ag-gauges">
            <Gauge value={agent.cpu_percent} label="CPU" />
            <Gauge
              value={agent.mem_percent}
              label={`Memory  ${(agent.mem_used ?? 0).toLocaleString()} / ${(agent.mem_total ?? 0).toLocaleString()} MB`}
            />
            {topDisks.map((d, i) => (
              <Gauge key={i} value={d.percent} label={`Disk ${d.path}`} />
            ))}
          </div>

          <div className="ag-stats">
            <div>
              <div className="ag-stat-label">Load avg</div>
              <div className="ag-stat-val" style={{ fontSize: '0.8rem' }}>
                {fmtLoad(agent.load_1)} / {fmtLoad(agent.load_5)} / {fmtLoad(agent.load_15)}
              </div>
            </div>
            <div>
              <div className="ag-stat-label">Processes</div>
              <div className="ag-stat-val">{agent.process_count ?? '—'}</div>
            </div>
            <div>
              <div className="ag-stat-label">Uptime</div>
              <div className="ag-stat-val">{fmtUptime(agent.uptime_seconds)}</div>
            </div>
            <div>
              <div className="ag-stat-label">Net sent</div>
              <div className="ag-stat-val ag-stat-val-sm">{fmtBytes(agent.net_bytes_sent)}</div>
            </div>
            <div>
              <div className="ag-stat-label">Net recv</div>
              <div className="ag-stat-val ag-stat-val-sm">{fmtBytes(agent.net_bytes_recv)}</div>
            </div>
            <div>
              <div className="ag-stat-label">Reported</div>
              <div className="ag-stat-val ag-stat-val-sm">{timeAgo(agent.last_metric_at)}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="ag-no-data">Waiting for first report…</div>
      )}

      {showTerminal && (
        <CommandTerminal agentId={agent.id} agentName={agent.name} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Agents() {
  const [agents, setAgents]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showInstall, setShowInstall] = useState(false);

  // Use the actual origin so install commands work for both http and https
  const serverUrl = window.location.origin;

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/agents');
      setAgents(data.agents || []);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const deleteAgent = async (id) => {
    try {
      await axios.delete(`/api/agents/${id}`);
      setAgents(prev => prev.filter(a => a.id !== id));
    } catch (_) {}
  };

  const onlineCount = agents.filter(a => isOnline(a.last_seen_at)).length;

  return (
    <div className="container agents-page">

      {/* ── Header ── */}
      <div className="ag-header">
        <div className="ag-header-left">
          <h2 className="ag-page-title">Agents</h2>
          {agents.length > 0 && (
            <span className="ag-count-pill">
              {onlineCount} / {agents.length} online
            </span>
          )}
        </div>
        <button
          className={`ag-install-toggle${showInstall ? ' ag-install-toggle-active' : ''}`}
          onClick={() => setShowInstall(v => !v)}
        >
          {showInstall ? '✕ Close' : '+ Add Agent'}
        </button>
      </div>

      {/* ── Install panel ── */}
      {showInstall && <InstallPanel serverUrl={serverUrl} />}

      {/* ── Content ── */}
      {loading ? (
        <div className="ag-loading">Loading agents…</div>
      ) : agents.length === 0 ? (
        <div className="ag-empty">
          <div className="ag-empty-icon">🖥</div>
          <div className="ag-empty-title">No agents registered yet</div>
          <div className="ag-empty-sub">
            Click <strong>+ Add Agent</strong> above to get the install commands.
          </div>
        </div>
      ) : (
        <div className="ag-grid">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} onDelete={deleteAgent} />
          ))}
        </div>
      )}
    </div>
  );
}
