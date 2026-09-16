import React from 'react';
import type { ScreenAnalysisResult } from '../shared/contracts';

interface Props { analysis: ScreenAnalysisResult; mode: 'focus' | 'read' | 'hear' | 'dyslexic'; }

/** Renders transient analysis for arbitrary shared content when no Access Pack exists. */
export function ScreenAnalysisView({ analysis, mode }: Props): React.ReactElement {
  if (mode === 'hear') {
    return <section className="mode-panel"><p className="eyebrow">Hear · live screen analysis</p><h3>{analysis.title}</h3><p>{analysis.audioDescription}</p></section>;
  }
  if (mode === 'focus') {
    return <section className="mode-panel"><p className="eyebrow">Focus · live screen analysis</p><h3>{analysis.title}</h3>{analysis.focusRegion ? <><h4>{analysis.focusRegion.label}</h4><p>{analysis.focusRegion.description}</p></> : <p>{analysis.summary}</p>}</section>;
  }
  return <section className={`mode-panel${mode === 'dyslexic' ? ' dyslexic-mode' : ''}`}><p className="eyebrow">{mode === 'dyslexic' ? 'Dyslexic text' : 'Read'} · live screen analysis</p><h3>{analysis.title}</h3><p>{analysis.summary}</p><ol>{analysis.text.map((line, index) => <li key={index}>{line}</li>)}</ol></section>;
}
