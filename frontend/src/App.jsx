
import React, { useMemo, useState } from 'react';
import { Boxes, ChartNoAxesCombined, LineChart, Network, Workflow } from 'lucide-react';
import AssociationMining from './components/AssociationMining.jsx';
import BoxSurvival from './components/BoxSurvival.jsx';
import EDADashboard from './components/EDADashboard.jsx';
import SequentialMining from './components/SequentialMining.jsx';
import TrendAdvisor from './components/TrendAdvisor.jsx';
import './style.css';

const APPS = [
  { key: 'box', title: 'Box Plot & Survival', subtitle: 'Duration distribution + Kaplan curves', icon: Boxes, Component: BoxSurvival },
  { key: 'trend', title: 'Trend Advisor', subtitle: 'Top 3 slope-based combinations', icon: LineChart, Component: TrendAdvisor },
  { key: 'eda', title: 'Executive EDA', subtitle: 'Delay analytics dashboard', icon: ChartNoAxesCombined, Component: EDADashboard },
  { key: 'association', title: 'Delay Association', subtitle: 'Market-basket style rules', icon: Network, Component: AssociationMining },
  { key: 'sequential', title: 'Sequential Mining', subtitle: 'Common delay sequences', icon: Workflow, Component: SequentialMining },
];

export default function App() {
  const [active, setActive] = useState('box');
  const selected = useMemo(() => APPS.find(a => a.key === active) || APPS[0], [active]);
  const ActiveComponent = selected.Component;
  return (
    <div className="unified-shell">
      <aside className="side-tabs">
        <div className="brand">
          <h1>Delay Analytics Workbench</h1>
          <p>Single upload-analysis suite with independent modules.</p>
        </div>
        {APPS.map(item => {
          const Icon = item.icon;
          return (
            <button key={item.key} className={`tab-button ${active === item.key ? 'active' : ''}`} onClick={() => setActive(item.key)}>
              <Icon />
              <span><span className="tab-title">{item.title}</span><span className="tab-subtitle">{item.subtitle}</span></span>
            </button>
          );
        })}
      </aside>
      <main className="main-stage">
        <div className="unified-header">
          <h2>{selected.title}</h2>
          <p>{selected.subtitle}</p>
        </div>
        <div className="app-panel"><ActiveComponent /></div>
      </main>
    </div>
  );
}
