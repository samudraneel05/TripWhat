import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertCircle, Search, MapPin, Cloud, Calendar, Brain, Wrench } from 'lucide-react';
import type { ToolActivity } from '../../../stores/chatStore';

interface ToolActivityBarProps {
  activities: ToolActivity[];
  isLoading: boolean;
}

// Map tool names to icons
const TOOL_ICONS: Record<string, typeof Search> = {
  mcp_search_places: Search,
  mcp_find_nearby: MapPin,
  mcp_compute_routes: MapPin,
  mcp_resolve_names: MapPin,
  mcp_lookup_weather: Cloud,
  web_search: Search,
  plan_trip: MapPin,
  build_itinerary: Calendar,
  edit_itinerary: Calendar,
  create_calendar_event: Calendar,
  ask_question: Brain,
  remember_user_preference: Brain,
};

function getToolIcon(toolName: string): typeof Search {
  // Check exact match first, then prefix match for itinerary_build_* etc.
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName];
  if (toolName.startsWith('itinerary_build_')) return Wrench;
  return Wrench;
}

// Convert a present-tense label to past tense for completed rows.
// "Searching X" → "Searched X", "Finding X" → "Found X", etc.
function toPastTense(label: string): string {
  const conversions: [RegExp, string][] = [
    [/^Searching (.+)/, 'Searched $1'],
    [/^Finding (.+)/, 'Found $1'],
    [/^Computing (.+)/, 'Computed $1'],
    [/^Checking (.+)/, 'Checked $1'],
    [/^Planning (.+)/, 'Planned $1'],
    [/^Building (.+)/, 'Built $1'],
    [/^Curating (.+)/, 'Curated $1'],
    [/^Editing (.+)/, 'Edited $1'],
    [/^Resolving (.+)/, 'Resolved $1'],
    [/^Saving (.+)/, 'Saved $1'],
    [/^Adding (.+)/, 'Added $1'],
    [/^Preparing (.+)/, 'Prepared $1'],
  ];
  for (const [re, replacement] of conversions) {
    if (re.test(label)) return label.replace(re, replacement);
  }
  return label;
}

// Human-readable base label per backend progress group.
const GROUP_LABELS: Record<string, string> = {
  place_search: 'Searching places',
  day_build: 'Curating days',
  extras: 'Finishing touches',
};

const GROUP_ICONS: Record<string, typeof Search> = {
  place_search: Search,
  day_build: Calendar,
  extras: Wrench,
};

// Longest common prefix across labels, trimmed to a word boundary.
function commonPrefix(members: ToolActivity[]): string {
  let prefix = members[0]?.label || '';
  for (const m of members.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < m.label.length && prefix[i] === m.label[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const lastSpace = prefix.lastIndexOf(' ');
  if (lastSpace > 0) prefix = prefix.slice(0, lastSpace);
  return prefix.replace(/[\s—:·-]+$/, '');
}

// Label for a collapsed group row, e.g. "Searching places in Tokyo".
// Appends the shared city when every member label ends with "in <city>".
function groupLabel(group: string, members: ToolActivity[]): string {
  const base = GROUP_LABELS[group] || commonPrefix(members) || members[0]?.label || 'Working';
  const cities = members.map(
    (m) => m.label.match(/ in ([^—·]+?)(?:\s*—.*)?$/)?.[1]
  );
  if (cities.length > 0 && cities.every((c) => c && c === cities[0])) {
    return `${base} in ${cities[0]}`;
  }
  return base;
}

type DisplayItem =
  | { kind: 'single'; act: ToolActivity }
  | { kind: 'group'; group: string; members: ToolActivity[] };

// Collapse activities sharing a `group` (≥2 members) into one item,
// rendered at the position of the group's first member.
function groupActivities(activities: ToolActivity[]): DisplayItem[] {
  const byGroup = new Map<string, ToolActivity[]>();
  for (const a of activities) {
    if (!a.group) continue;
    const list = byGroup.get(a.group);
    if (list) list.push(a);
    else byGroup.set(a.group, [a]);
  }
  const items: DisplayItem[] = [];
  const seen = new Set<string>();
  for (const a of activities) {
    const members = a.group ? byGroup.get(a.group) : undefined;
    if (!members || members.length < 2) {
      items.push({ kind: 'single', act: a });
      continue;
    }
    if (seen.has(a.group!)) continue;
    seen.add(a.group!);
    items.push({ kind: 'group', group: a.group!, members });
  }
  return items;
}

export function ToolActivityBar({ activities, isLoading }: ToolActivityBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const renderActivityRow = (act: ToolActivity, showSummary: boolean) => {
    const Icon = getToolIcon(act.toolName);
    return (
      <div
        key={act.callId}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--sage)]/50 transition-colors"
      >
        <Icon className="w-3 h-3 text-[var(--muted)] shrink-0" />
        {showSummary ? (
          <div className="flex-1 min-w-0">
            <span className="text-[11px] text-[var(--ink)] truncate block">
              {act.label}
            </span>
            {act.summary && (
              <span className="text-[10px] text-[var(--muted)] truncate block">
                {act.summary}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[var(--ink)] flex-1 truncate">
            {act.label}
          </span>
        )}
        {act.status === 'running' && (
          <Loader2 className="w-3 h-3 text-[var(--peach)] animate-spin shrink-0" />
        )}
        {act.status === 'finished' && (
          <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
        )}
        {act.status === 'error' && (
          <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
        )}
      </div>
    );
  };

  if (!activities || activities.length === 0) return null;

  const running = activities.filter((a) => a.status === 'running');
  const finished = activities.filter((a) => a.status === 'finished');
  const errored = activities.filter((a) => a.status === 'error');

  // During loading: show live activity list
  if (isLoading) {
    return (
      <div className="mt-2 mb-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex items-center gap-1">
              {running.length > 0 ? (
                <>
                  <Loader2 className="w-3 h-3 text-[var(--peach)] animate-spin" />
                  <span className="text-[11px] font-medium text-[var(--ink)]">
                    {running.length > 1
                      ? `${running.length} searches running`
                      : running[0]?.label || 'Working...'}
                  </span>
                </>
              ) : (
                <>
                  <Loader2 className="w-3 h-3 text-[var(--muted)] animate-spin" />
                  <span className="text-[11px] font-medium text-[var(--muted)]">
                    {activities[activities.length - 1]?.label || 'Working...'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Activity list — grouped when ≥2 running tasks share a group */}
          {activities.length > 1 && (
            <div className="border-t border-[var(--border)]">
              {groupActivities(activities).map((item) => {
                if (item.kind === 'single') {
                  return renderActivityRow(item.act, false);
                }
                const groupRunning = item.members.filter((m) => m.status === 'running');
                const groupErrors = item.members.filter((m) => m.status === 'error');
                const isOpen = expandedGroups.has(item.group) || groupErrors.length > 0;
                const GroupIcon = GROUP_ICONS[item.group] || getToolIcon(item.members[0]?.toolName || '');
                const label = groupLabel(item.group, item.members);
                return (
                  <div key={`group-${item.group}`}>
                    <button
                      onClick={() => toggleGroup(item.group)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--sage)]/50 transition-colors text-left"
                    >
                      <GroupIcon className="w-3 h-3 text-[var(--muted)] shrink-0" />
                      <span className="text-[11px] text-[var(--ink)] flex-1 truncate">
                        {groupRunning.length > 0
                          ? `${label} · ${groupRunning.length} parallel`
                          : `${toPastTense(label)} · ${item.members.length}`}
                      </span>
                      {groupRunning.length > 0 && (
                        <Loader2 className="w-3 h-3 text-[var(--peach)] animate-spin shrink-0" />
                      )}
                      {groupRunning.length === 0 && groupErrors.length > 0 && (
                        <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                      )}
                      {groupRunning.length === 0 && groupErrors.length === 0 && (
                        <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
                      )}
                      {isOpen ? (
                        <ChevronDown className="w-3 h-3 text-[var(--muted)] shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-[var(--muted)] shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="border-t border-[var(--border)]">
                        {item.members.map((act) => renderActivityRow(act, false))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // After loading: collapsed bar that expands to show all results
  const totalFound = finished.length;

  // Build a nice past-tense header from the finished activities
  function buildHeader(): string {
    if (errored.length > 0) {
      return `${totalFound} completed · ${errored.length} failed`;
    }
    if (totalFound === 1) {
      const act = finished[0];
      const pastLabel = toPastTense(act?.label || 'Completed');
      // Combine past-tense label with summary count if available
      if (act?.summary) {
        // Extract count from summaries like "5 places found", "3 results found"
        const countMatch = act.summary.match(/^(\d+)\s+(.+?)\s+found$/);
        if (countMatch) {
          return `${pastLabel} — ${countMatch[1]} ${countMatch[2]} found`;
        }
        return `${pastLabel} — ${act.summary}`;
      }
      return pastLabel;
    }
    // Multiple activities: summarize counts
    const withCounts = finished.filter((a) => a.summary);
    if (withCounts.length > 0) {
      const parts = withCounts.map((a) => {
        const countMatch = a.summary?.match(/^(\d+)\s+(.+?)\s+found$/);
        if (countMatch) return `${countMatch[1]} ${countMatch[2]}`;
        return a.summary;
      });
      return `Completed — ${parts.join(', ')}`;
    }
    return `${totalFound} searches completed`;
  }

  const headerLabel = buildHeader();

  return (
    <div className="mt-1 mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--sage)]/50 transition-colors group"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-[var(--muted)] shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[var(--muted)] shrink-0 transition-transform group-hover:translate-x-0.5" />
        )}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
          <span className="text-[11px] font-medium text-[var(--ink)] truncate">
            {headerLabel}
          </span>
        </div>
        {errored.length > 0 && (
          <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
          {groupActivities(activities).map((item) => {
            if (item.kind === 'single') {
              return renderActivityRow(item.act, true);
            }
            const groupErrors = item.members.filter((m) => m.status === 'error');
            const isOpen = expandedGroups.has(item.group) || groupErrors.length > 0;
            const GroupIcon = GROUP_ICONS[item.group] || getToolIcon(item.members[0]?.toolName || '');
            const label = toPastTense(groupLabel(item.group, item.members));
            return (
              <div key={`group-${item.group}`}>
                <button
                  onClick={() => toggleGroup(item.group)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--sage)]/50 transition-colors text-left"
                >
                  <GroupIcon className="w-3 h-3 text-[var(--muted)] shrink-0" />
                  <span className="text-[11px] text-[var(--ink)] flex-1 truncate">
                    {label} · {item.members.length}
                  </span>
                  {groupErrors.length > 0 ? (
                    <AlertCircle className="w-3 h-3 text-red-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />
                  )}
                  {isOpen ? (
                    <ChevronDown className="w-3 h-3 text-[var(--muted)] shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-[var(--muted)] shrink-0" />
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-[var(--border)]">
                    {item.members.map((act) => renderActivityRow(act, true))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
