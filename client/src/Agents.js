import React, { useState, useEffect, useCallback } from 'react';
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

// ── Install instructions panel ────────────────────────────────────────────────

function InstallPanel({ serverUrl }) {
  const scriptCmd    = `curl -fsSL ${serverUrl}/api/agents/script   -o skywatch-agent.sh`;
  const installerCmd = `curl -fsSL ${serverUrl}/api/agents/installer -o install-agent.sh`;
  const runCmd       = `sudo bash install-agent.sh --server-url ${serverUrl}`;

  return (
    <div className="ag-install-panel">
      <h3 className="ag-install-title">Install agent on a Linux host</h3>
      <p className="ag-install-note">
        Run the following on the target machine (Ubuntu 16.04+ / Debian 9+ / RHEL 7+).
        The agent registers itself automatically and appears here within a minute.
      </p>

      <div className="ag-install-steps">
        <div className="ag-step">
          <span className="ag-step-num">1</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Download the scripts</div>
            <CopyCmd cmd={scriptCmd} />
            <CopyCmd cmd={installerCmd} />
          </div>
        </div>

        <div className="ag-step">
          <span className="ag-step-num">2</span>
          <div className="ag-step-body">
            <div className="ag-step-label">Run the installer as root</div>
            <CopyCmd cmd={runCmd} />
          </div>
        </div>
      </div>

      <p className="ag-install-note ag-install-note-sm">
        Optional flags: <code>--interval&nbsp;&lt;secs&gt;</code> (default&nbsp;60),{' '}
        <code>--name&nbsp;&lt;label&gt;</code>, <code>--registration-key&nbsp;&lt;key&gt;</code>.
        To remove: <code>sudo bash install-agent.sh --uninstall</code>
      </p>
    </div>
  );
}

// ── Single agent card ─────────────────────────────────────────────────────────

function AgentCard({ agent, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
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
          <h2 className="ag-page-title">Linux Agents</h2>
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
