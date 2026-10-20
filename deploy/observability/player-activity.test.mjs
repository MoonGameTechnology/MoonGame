/* global Response */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createExporter, projectSource, renderMetrics } from './game-exporter.mjs';
const at=Date.UTC(2026,9,20,12);
const fixture=()=>({schema:1,since:at-86400000,at,online:2,days:[{day:'2026-10-19',players:3,visits:8,seconds:7200},{day:'2026-10-20',players:2,visits:5,seconds:1234}],accountId:'never-expose',ip:'never-expose'});
describe('aggregate player activity boundary',()=>{
  it('exports daily gauges with a bounded date label and no identities',()=>{
    const output=renderMetrics(projectSource('activity',fixture()).samples);
    expect(output).toContain('moongame_players_online 2');
    expect(output).toContain('moongame_player_activity_daily_online_seconds{day="2026-10-19"} 7200');
    expect(output).not.toContain('never-expose');expect(output).not.toContain('accountId');
  });
  it.each([
    x=>{x.days=Array(31).fill(x.days[0]);},x=>{x.days[0].day='account-identity';},
    x=>{x.days[0].day='2026-99-99';},x=>{x.days[0].day='2026-09-01';},x=>{x.days[1].day='2026-10-21';},
    x=>{x.days[0].seconds=Infinity;},x=>{x.days[0].seconds=3*86400+1;},x=>{x.online=-1;},
  ])('refuses malformed or unbounded day data',mutate=>{const x=fixture();mutate(x);expect(projectSource('activity',x)).toBeNull();});
  it('keeps absence distinct from zero after a source failure',async()=>{
    let fail=false;
    const exporter=createExporter({now:()=>at,request:async url=>new Response(JSON.stringify(fixture()),{status:url.endsWith('/metrics/activity')&&!fail?200:503})});
    expect(await exporter.scrape()).toContain('moongame_players_online 2');fail=true;
    const output=await exporter.scrape();expect(output).toContain('moongame_source_up{source="activity"} 0');expect(output).not.toContain('moongame_players_online');
  });
  it('provisions private daily charts with explicit semantics and stale gating',()=>{
    const dashboard=JSON.parse(readFileSync(new URL('./grafana/provisioning/dashboards/player-activity.json',import.meta.url),'utf8'));
    expect(dashboard.uid).toBe('moongame-player-activity');expect(dashboard.timezone).toBe('utc');
    expect(dashboard.panels.filter(p=>p.type==='barchart')).toHaveLength(4);
    for(const panel of dashboard.panels.filter(p=>p.targets))expect(panel.targets[0].expr).toContain('moongame_player_activity_sample_timestamp_seconds < 45');
    expect(dashboard.panels.find(p=>p.type==='text').options.content).toContain('30 секунд');
  });
});
