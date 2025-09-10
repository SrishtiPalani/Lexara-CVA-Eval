import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Component, ErrorInfo } from 'react';
import axios from 'axios';
import { Button, Select, Divider, Table, Tag, Drawer, Collapse, Tooltip, Switch, theme, Modal, Popover, Statistic, Alert, Typography, Input, Card, Form, Space, Upload, message, Progress, Skeleton, Checkbox } from 'antd';
import { InfoCircleOutlined, SettingOutlined, DownOutlined, UpOutlined, BarChartOutlined, QuestionCircleOutlined, EyeInvisibleOutlined, EyeOutlined, CloseCircleOutlined, StopOutlined, TableOutlined, DownloadOutlined, PieChartFilled, SlidersOutlined } from '@ant-design/icons';
import type { CollapseProps } from 'antd/es/collapse';


import { v4 as uuid } from "uuid";
import YAML from 'js-yaml';  

import { ColumnGroupType, ColumnsType, ColumnType } from 'antd/es/table';

import { API_BASE } from './api';
// Import the metrics utility functions
import { 
    MetricScores, 
    averageMetrics,
    computeMetrics, 
    computeVisualizationSubcategoryScores,
    computeOverallVisualizationScore,
    ModelMetricsMap
} from './metrics';
import { useEvaluationStream } from './useEvaluationStream';

import { JudgeEvaluationLoadingSkeleton } from './JudgeEvaluationLoadingSkeleton';
// Import styling in css 
import './TestCaseEvaluation.css';

import UserUtteranceCell from './UserUtteranceCell';
import { JudgeMetricInfo, JudgeMetricKey, judgeMetricsInfo, JudgeScoreKey, NaturalLanguageOverallMetrics } from './NaturalLanguageOverallMetrics';
import { averageVisualizationMetrics, VisualizationOverallMetrics } from './VisualizationOverallMetrics';
import { AccuracyMetrics } from './AccuracyMetrics';

// import interfaces
import { DatasourceField, EvaluationResult, EvaluationDataRecord, TestCase, FAQPanel } from './types'; 

// Imports for identifying, highlighting and describing differences between notional spec outputs and then converting notional spec to vega spec
import {
    getDifferences,
    groupByTestNumber, 
    getDifficultyTagColor, 
    getDomainTagColor, 
    getDomainIcon,
    prettyModelPromptName, 
  } from './utils';

import { convertNotionalSpecToVegaSpec, describeVegaSpec } from './vizspecUtils'

import { models, testCaseMapping, modelFamily, judgeStrengthOrder } from './constants';
import MetricsByLabelPanel from './MetricsByLabelPanel';
import ExpectedResponseCell from './ExpectedResponseCell';
import ModelResponseCell from './ModelResponseCell';
import LabelsCell from './LabelsCell';
import PromptList, { Prompt } from './PromptList';
import { METRIC_TREE, NL_METRICS, SPEC_METRICS, VIZ_METRICS } from './metricsCatalog';


const { Panel } = Collapse;



// For anonymizing the model for TC Labs
export const modelNameMap: Record<string, string> = {
  "openai-gpt-5"                : "gpt-5",
  "openai-gpt-5-mini"           : "gpt-5-mini",
  "openai-gpt-5-nano"           : "gpt-5-nano",
  "openai-gpt-4o"               : "4o",
  "openai-gpt-4.1"              : "gpt-4.1",
  "openai-o3"                   : "o3",
  "openai-o4-mini"              : "o4-mini",
  "anthropic-claude-3.7-sonnet" : "claude-sonnet",
  "anthropic-claude-opus-4"     : "claude-opus",
  "deepseek-r1"                 : "deepseek-r1",
  "SFR-Tableau-Finetuned"       : "einstein-tableau-gpt",
};


// Prompt template only to show in the information drawer 
const defaultSystemPrompt = `You are a system that converts analytical queries into visualization specs following a strict JSON schema.
You must return a valid JSON object with exactly two top-level fields:
1) "content": the notional spec (matching the schema)
2) "user_friendly_reply": a short description in plain English of what the visualization shows, and if it is a follow-up then acknowledge that in the text.

(You will be sent the full JSON schema, the datasource, and the user's query in the same message.)`;

// Notional spec schema to show the user what the prompt looks like
const schema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Notional Specification",
    "description": "A high-level representation of a visualization",
    "version": "0.2.0",
    "type": "object",
    "properties": {
      "version": { "type": "string" },
      "fields": {
        "type": "array",
        "items": { "$ref": "#/definitions/FieldInstance" }
      },
      "chart": {
        "type": "string",
        "enum": [
          "text", "heatmap", "bar", "stackedbar", "line", "dualline", "area",
          "gantt", "boxplot", "scatterplot", "histogram", "symbolmap", "filledmap",
          "treemap", "pie", "bullet", "bubble"
        ]
      },
      "relativeDateFilters": {
        "type": "array",
        "items": { "$ref": "#/definitions/RelativeDateFilter" }
      },
      "dateRangeFilters": {
        "type": "array",
        "items": { "$ref": "#/definitions/DateRangeFilter" }
      },
      "rangeFilters": {
        "type": "array",
        "items": { "$ref": "#/definitions/NumericRangeFilter" }
      },
      "categoricalFilters": {
        "type": "array",
        "items": { "$ref": "#/definitions/CategoricalFilter" }
      },
      "sort": { "$ref": "#/definitions/SortingSpec" }
    },
    "definitions": {
      "FieldInstance": {
        "type": "object",
        "properties": {
          "caption": { "type": "string" },
          "data": {
            "type": "string",
            "enum": [ "number", "string", "date", "boolean", "geographic", "set" ]
          },
          "type": { "type": "string", "enum": [ "discrete", "continuous" ] },
          "role": { "type": "string", "enum": [ "dimension", "measure" ] },
          "aggregation": {
            "type": "string",
            "enum": [ "default", "count", "countd", "sum", "avg", "max", "min", "median",
                       "year", "qtr", "month", "week", "day", "hour", "minute", "second" ]
          },
          "encoding": {
            "type": "string",
            "enum": [ "color", "size", "text", "shape", "x", "y" ]
          },
          "fieldIdentifier": { "type": "string" }
        },
        "required": [ "caption", "data", "type", "role" ]
      },
      "SortingSpec": {
        "type": "object",
        "properties": {
          "field": { "type": "string" },
          "by": { "type": "string" },
          "aggregation": {
            "type": "string",
            "enum": [ "default", "count", "countd", "sum", "avg", "max", "min",
                      "median", "year", "qtr", "month", "week", "day", "hour",
                      "minute", "second" ]
          },
          "direction": { "type": "string", "enum": [ "asc", "desc" ] }
        },
        "required": [ "by" ]
      },
      "RelativeDateFilter": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": [ "relative-date" ] },
          "field": { "type": "string" },
          "includeNull": { "type": "boolean" },
          "amount": { "type": "number" },
          "period": { "type": "string", "enum": [ "days", "weeks", "months", "quarters", "years" ] },
          "direction": { "type": "string", "enum": [ "next", "previous" ] },
          "anchor": { "type": "string" },
          "fieldIdentifier": { "type": "string" }
        },
        "required": [ "type", "field", "amount", "period", "direction" ]
      },
      "DateRangeFilter": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": [ "date-range" ] },
          "field": { "type": "string" },
          "includeNull": { "type": "boolean" },
          "start": { "type": "string" },
          "end": { "type": "string" },
          "fieldIdentifier": { "type": "string" }
        },
        "required": [ "type", "field" ]
      },
      "NumericRangeFilter": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": [ "numeric-range" ] },
          "field": { "type": "string" },
          "includeNull": { "type": "boolean" },
          "start": { "type": "number" },
          "end": { "type": "number" },
          "aggregation": {
            "type": "string",
            "enum": [ "default", "count", "countd", "sum", "avg", "max", "min",
                      "median", "year", "qtr", "month", "week", "day", "hour",
                      "minute", "second" ]
          },
          "fieldIdentifier": { "type": "string" }
        },
        "required": [ "type", "field" ]
      },
      "CategoricalFilter": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": [ "categorical" ] },
          "field": { "type": "string" },
          "values": {
            "type": "array",
            "items": { "type": [ "string", "number" ] }
          },
          "exclude": { "type": "boolean" },
          "limit": { "$ref": "#/definitions/LimitOptions" },
          "condition": { "$ref": "#/definitions/ConditionOptions" },
          "fieldIdentifier": { "type": "string" }
        },
        "required": [ "type", "field" ]
      },
      "LimitOptions": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": [ "top", "bottom" ] },
          "limit": { "type": "number" },
          "field": { "type": "string" },
          "aggregation": {
            "type": "string",
            "enum": [ "default", "count", "countd", "sum", "avg", "max", "min",
                      "median", "year", "qtr", "month", "week", "day", "hour",
                      "minute", "second" ]
          }
        },
        "required": [ "type", "limit", "field", "aggregation" ]
      },
      "ConditionOptions": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": [ "condition" ] },
          "value": { "type": "number" },
          "operator": { "type": "string", "enum": [ ">", ">=", "<", "<=", "==", "<>" ] },
          "field": { "type": "string" },
          "aggregation": {
            "type": "string",
            "enum": [ "default", "count", "countd", "sum", "avg", "max", "min",
                      "median", "year", "qtr", "month", "week", "day", "hour",
                      "minute", "second" ]
          }
        },
        "required": [ "type", "value", "operator", "field", "aggregation" ]
      }
    },
    "required": [ "version", "fields" ]
};

type Unit = '%' | 'rating' | 'binary';

const describeRange = (range: [number, number] | 'binary', unit: Unit) => {
  if (range === 'binary') return unit === '%' ? '0 or 100%' : '0 or 100';
  const [lo, hi] = range;
  return unit === '%' ? `${lo}–${hi}%` : `${lo}–${hi} rating`;
};

export function InfoIcon({ title }: { title: React.ReactNode }) {
  return (
    <Tooltip title={title}>
      <InfoCircleOutlined
        className="metric-info-icon"
        style={{ marginLeft: 6, opacity: 0.8, cursor: 'help' }}
      />
    </Tooltip>
  );
}

/** Compose tooltip content from our meta tables */
const metricTooltip = (key: string) => {
  const m = metricsMap.get(key as any);
  if (m && 'unit' in m && 'range' in m) {
    return (
      <div>
        <div style={{ fontWeight: 600 }}>{m.label}</div>
        <div style={{ marginTop: 6 }}>{m.definition}</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Range: {describeRange(m.range as any, m.unit as any)}
        </div>
      </div>
    );
  }
  // NL judge metrics (assumptions, insightfulness, coherence, follow_up_relevance)
  const j = judgeInfoMap.get(key as any);
  if (j) {
    // all judge star-metrics are 1–5 (rating)
    return (
      <div>
        <div style={{ fontWeight: 600 }}>{j.label}</div>
        <div style={{ marginTop: 6 }}>{j.definition}</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Range: 1–5 rating
        </div>
      </div>
    );
  }
  return 'No description available';
};

/** Wrap a metric label with the info icon */
export const labelWithInfo = (label: string, key: string) => (
  <span>
    {label}
    <InfoIcon title={metricTooltip(key)} />
  </span>
);

export const metricsToDisplay: {
  key: string;
  label: string;
  displayFn: (ms: MetricScores) => number;
  definition: string;
  unit: Unit;                              // ← NEW
  range: [number, number] | 'binary';      // ← NEW
}[] = [
  {
    key: 'precision',
    label: 'Precision',
    displayFn: ms => ms.score_precision_recall_f1.precision,
    definition: 'Proportion of n-grams in the actual output that also appear in the expected output.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'recall',
    label: 'Recall',
    displayFn: ms => ms.score_precision_recall_f1.recall,
    definition: 'Proportion of n-grams in the expected output that appear in the actual output.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'f1',
    label: 'F1 Score',
    displayFn: ms => ms.score_precision_recall_f1.f1,
    definition: 'Harmonic mean of precision and recall.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'dataFidelity',
    label: 'Data Fidelity',
    displayFn: ms => ms.data_fidelity,
    definition: 'Checks that the compiled data table exactly matches the ground-truth rows and columns.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'fieldSimilarity',
    label: 'Field Similarity',
    displayFn: ms => ms.field_similarity,
    definition: 'How closely X and Y fields match expected ones, with credit for matching data types.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'filterAccuracy',
    label: 'Filter Accuracy',
    displayFn: ms => ms.filter_accuracy,
    definition: 'Verifies that all expected filters are present and identical.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'sortAccuracy',
    label: 'Sort Accuracy',
    displayFn: ms => ms.sort_accuracy,
    definition: 'Ensures the resultant data set is sorted exactly as specified or implicitly expected.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'chartTypeAcc',
    label: 'Chart-Type',
    displayFn: ms => ms.chart_type_accuracy,
    definition: '100 if the chosen mark type matches expected; 0 otherwise.',
    unit: '%',
    range: 'binary', // 0 or 100%
  },
  {
    key: 'chartSimilarity',
    label: 'Chart Similarity',
    displayFn: ms => ms.chart_similarity,
    definition: 'Alignment of chosen mark type with Tableau Show Me recommendations for the same fields.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'xAxisAcc',
    label: 'X-Axis Accuracy',
    displayFn: ms => ms.axis.x_axis_accuracy,
    definition: 'Structural identity with expected X axis (field, side/orient, scale, zero baseline).',
    unit: '%',
    range: 'binary',
  },
  {
    key: 'yAxisAcc',
    label: 'Y-Axis Accuracy',
    displayFn: ms => ms.axis.y_axis_accuracy,
    definition: 'Structural identity with expected Y axis (field, side/orient, scale, zero baseline).',
    unit: '%',
    range: 'binary',
  },
  {
    key: 'aestheticAccuracy',
    label: 'Visual Encodings',
    displayFn: ms => ms.aesthetic_accuracy,
    definition: 'Correctness of non-data encodings (color, shape, opacity, text, size).',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'tooltipAcc',
    label: 'Interactivity',
    displayFn: ms => ms.interactivity.tooltip_accuracy,
    definition: 'Checks tooltip fields are correctly surfaced.',
    unit: '%',
    range: [0, 100],
  },
  {
    key: 'information_similarity',
    label: 'Info Similarity',
    displayFn: ms => ms.information_similarity * 100,
    definition: 'Semantic cosine similarity of the model\'s reply vs expected.',
    unit: '%',
    range: [0, 100],
  },
];


// simple boundary so a bad cell can't white-screen the whole app
class TableErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    /* still log for debugging */
    console.error('[UI] table render error', error, info);
  }
  render() {
    if (this.state.hasError)
      return <Alert type="error" message="Something went wrong rendering the table." />;
    return this.props.children;
  }
}


// Fast lookup maps for metric definitions
const metricsMap = new Map<string, typeof metricsToDisplay[number]>(
  metricsToDisplay.map(m => [m.key, m])
);

const judgeInfoMap = new Map<JudgeMetricKey, JudgeMetricInfo>(
  judgeMetricsInfo.map(j => [j.key, j])
);




/* ---------- color constants ---------- */
const COLOR_LOW  = { color: '#E54D37', background: 'rgba(229,77,55,0.1)' };
const COLOR_MED  = { color: '#F2B134', background: 'rgba(242,177,52,0.1)' };
const COLOR_HIGH = { color: '#1170AA', background: 'rgba(17,112,170,0.1)' };

export function badgeStyle(pct: number): { color: string; background: string } {
  if (pct < 33) return COLOR_LOW;
  if (pct < 66) return COLOR_MED;
  return COLOR_HIGH;
}

/** Collapse panel key for the datasource preview */
const DATASOURCE_PANEL_KEY = 'datasource';




/** ──────────────── Range / list → number[] helper ────────────────
 *  "1-5, 8, 11-13"   →  [1,2,3,4,5,8,11,12,13]
 *  Ignores bad tokens & drops duplicates. Used by the new
 *  "Number of Tests to Run" free-form field.
 */
export function parseTestRanges(str: string): number[] {
  const out = new Set<number>();
  str
    .replace(/[—–]/g, "-") // normalize em/en dash to hyphen
    .split(/[, ]+/)
    .filter(Boolean)
    .forEach(tok => {
      const [aRaw, bRaw] = tok.split('-');
      const a = parseInt(aRaw, 10);
      const b = parseInt(bRaw, 10);
      if (Number.isFinite(a) && !bRaw) {          // single number
        out.add(a);
      } else if (Number.isFinite(a) && Number.isFinite(b)) { // range
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let n = lo; n <= hi; n++) out.add(n);
      }
    });
  return Array.from(out).sort((x, y) => x - y);
}

export function EvaluateButton({ payload }: { payload: any }) {
  const { state, start, cancel } = useEvaluationStream();

  const pct = state.total ? Math.round((state.completed / state.total) * 100) : 0;

  return (
    <div>
      <button onClick={() => start(payload)} disabled={state.status === "running"}>
        {state.status === "running" ? "Running…" : "Run evaluation"}
      </button>
      {state.status === "running" && (
        <>
          <div style={{ height: 6, background: "#eee", marginTop: 8 }}>
            <div style={{ height: 6, width: `${pct}%` }} />
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {state.completed}/{state.total} ({pct}%)
            <button onClick={cancel} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </>
      )}
      {state.status === "error" && <div style={{ color: "crimson" }}>{state.error}</div>}
      {/* Render cells however you like: */}
      <pre style={{ maxHeight: 300, overflow: "auto" }}>
        {JSON.stringify(state.cells, null, 2)}
      </pre>
    </div>
  );
}

// Utility function to create an empty EvaluationDataRecord
function makeEmptyRecord(key: string): EvaluationDataRecord {
  return {
    key,
    file: '',
    input: '',
    canonical: '',
    paraphrases: [],
    expected_output: {},
    model_outputs: {},
    pass_fail: {},
    metrics: {},
    labels: [],
    modelConversionErrors: {},
    expectedErrors: [],
    expanded: false,
  };
}

// Bring-your-own-API-keys section           
type KeySrc   = 'env' | 'user' | 'missing';
type KeyStatus = 'ok' | 'fail';

const srcColor:   Record<KeySrc,   string> = { env: 'blue', user: 'gold', missing: 'red' };
const statusColor:Record<KeyStatus,string> = { ok:  'green', fail: 'red' };



interface ApiKeys {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SALESFORCE_API_KEY: string;
  EINSTEIN_API_KEY: string;
}
interface ApiKeyStatusMap {
  OPENAI_API_KEY?: KeyStatus;
  ANTHROPIC_API_KEY?: KeyStatus;
  SALESFORCE_API_KEY?: KeyStatus;
  EINSTEIN_API_KEY?: KeyStatus;
}

interface KeyFieldProps {
  label: string;
  docs?: string;
  value: string;
  status?: KeyStatus;
  src?: KeySrc;                    
  onChange: (v: string) => void;
}



const KeyField: React.FC<KeyFieldProps> = ({
  label, docs, value, status, src, onChange          // ← add src here
}) => (
  <Form.Item
    label={
      <>
        {label}&nbsp;
        {docs && (
          <Tooltip title={docs}>
            <QuestionCircleOutlined />
          </Tooltip>
        )}
        {src && (
          <Tag color={srcColor[src]} style={{ marginLeft: 4 }}>
            {src}
          </Tag>
        )}
        {status && (
          <Tag color={statusColor[status]} style={{ marginLeft: 4 }}>
            {status}
          </Tag>
        )}
      </>
    }
    style={{ marginBottom: 8 }}
  >
    <Input.Password
      value={value}
      autoComplete="off"
      onChange={e => onChange(e.target.value.trim())}
      iconRender={vis => (vis ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
      addonAfter={
        value && (
          <CloseCircleOutlined
            onClick={() => onChange('')}
            style={{ cursor: 'pointer' }}
          />
        )
      }
    />
  </Form.Item>
);

interface ApiKeySectionProps {
  keys: ApiKeys;
  setKeys: React.Dispatch<React.SetStateAction<ApiKeys>>;
  status: ApiKeyStatusMap;
  srcMap: Record<string, KeySrc>;        // ← NEW
}

const ApiKeySection: React.FC<ApiKeySectionProps> = ({
  keys, setKeys, status, srcMap
}) => (
  <Collapse size="small" defaultActiveKey={Object.values(keys).some(Boolean) ? ['api'] : []}>
    <Collapse.Panel header="Bring your own API keys" key="api">
      <Card size="small" type="inner">
        <KeyField
          label="OpenAI"
          docs="https://platform.openai.com/account/api-keys"
          value={keys.OPENAI_API_KEY}
          status={status.OPENAI_API_KEY}
          src={srcMap.OPENAI_API_KEY}        // ← pass source
          onChange={v => setKeys(k => ({ ...k, OPENAI_API_KEY: v }))}
        />
        <KeyField
          label="Anthropic"
          docs="https://console.anthropic.com/settings/keys"
          value={keys.ANTHROPIC_API_KEY}
          status={status.ANTHROPIC_API_KEY}
          src={srcMap.ANTHROPIC_API_KEY}
          onChange={v => setKeys(k => ({ ...k, ANTHROPIC_API_KEY: v }))}
        />
        <KeyField
          label="Salesforce Gateway"
          value={keys.SALESFORCE_API_KEY}
          status={status.SALESFORCE_API_KEY}
          src={srcMap.SALESFORCE_API_KEY}
          onChange={v => setKeys(k => ({ ...k, SALESFORCE_API_KEY: v }))}
        />
        <KeyField
          label="Einstein Gateway"
          value={keys.EINSTEIN_API_KEY}
          status={status.EINSTEIN_API_KEY}
          src={srcMap.EINSTEIN_API_KEY}
          onChange={v => setKeys(k => ({ ...k, EINSTEIN_API_KEY: v }))}
        />
      </Card>
    </Collapse.Panel>
  </Collapse>
);

// Visualization bucket definitions
export const vizBucketDefinitions: Record<'data'|'semantics'|'functionality'|'design',string> = {
  data:          'Composite score of Data Fidelity and Field Similarity',
  semantics:     'How logical the chart type is vs. expected (Tableau Show Me logic)',
  functionality: 'Average correctness of filters, sort, and axes',
  design:        'Average correctness of encodings and tooltips',
};

// Natural-Language bucket definitions
export const nlBucketDefinitions: Record<'analyticalThinking'|'conversationalQuality'|'factualGrounding',string> = {
  analyticalThinking:    'Average of Assumptions & Insightfulness (1–5 stars).',
  conversationalQuality: 'Average of Follow-Up Relevance & Coherence (1–5 stars).',
  factualGrounding:      'Semantic equivalence (0–100% score).',
};



interface MetricsLayoutProps {
// When true cards render in a single horizontal scroll-row.
scrollCards?: boolean;
}

// Returns the container style based on layout mode.
const flexContainerStyle = (scrollCards = false): React.CSSProperties =>
  scrollCards
    ? { display: 'flex', gap: 24, overflowX: 'auto', paddingBottom: 16 }
    : { display: 'flex', flexWrap: 'wrap', gap: 24 };

// Wrapper component so callers decide layout policy via prop.
const MetricsLayout: React.FC<React.PropsWithChildren<MetricsLayoutProps>> = ({
  scrollCards = false,
  children,
}) => <div style={flexContainerStyle(scrollCards)}>{children}</div>;

// FlexCard component to display cards in a flex layout
const FlexCard: React.FC<React.PropsWithChildren<{ title: string; loading?: boolean }>> =
  ({ title, loading, children }) => (
    <div style={{ flex: '0 0 max-content' }}>
      <Card
        title={title}
        loading={loading}
        style={{ minWidth: 'max-content' }}
        bodyStyle={{ overflowX: 'auto', padding: 16 }}
      >
        {children}
      </Card>
    </div>
);

// Utility to display JSON in a pretty <pre> block
const JsonDisplay: React.FC<{ data: any }> = ({ data }) => (
    <pre style={{
      backgroundColor: '#f5f5f5',
      padding: '10px',
      borderRadius: '4px',
      fontFamily: 'monospace',
      fontSize: '14px',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    }}>
      {JSON.stringify(data, null, 2)}
    </pre>
);

// A little helper for each legend entry
const LegendItem: React.FC<{
  color: string;
  background: string;
  label: string;
}> = ({ color, background, label }) => (
  <span style={{ display: "flex", alignItems: "center", marginLeft: 12 }}>
    <span
      style={{
        width: 12,
        height: 12,
        backgroundColor: background,
        border: `1px solid ${color}`,
        borderRadius: 2,
        display: "inline-block",
        marginRight: 6,
      }}
    />
    <span style={{ color, fontSize: 12 }}>{label}</span>
  </span>
);

// CSV Download function
const downloadEvaluationResultsAsCSV = (
  evaluationData: EvaluationDataRecord[],
  modelPromptKeys: string[],
  showSpecificRun: boolean,
  selectedRunIndex: number | null,
  dataValues: any[]
) => {
  // Validate input data
  if (!evaluationData || evaluationData.length === 0) {
    message.error('No evaluation data available to download');
    return;
  }
  
  if (!modelPromptKeys || modelPromptKeys.length === 0) {
    message.error('No model data available to download');
    return;
  }
  // Helper function to escape CSV values
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  // Helper function to get current run index for a record
  const getCurrentRunIndex = (record: EvaluationDataRecord): number | null => {
    if (!showSpecificRun) return null;
    return selectedRunIndex ?? record.representative_run_idx ?? 0;
  };

  // Helper function to extract visualization data
  const extractVisualizationData = (record: EvaluationDataRecord, modelKey: string, runIndex: number | null) => {
    const runResults = record.run_results;
    const currentRun = runIndex !== null ? runResults?.[runIndex] : null;
    
    // Get the raw model output
    const rawOutput = currentRun?.model_outputs?.[modelKey] ?? record.model_outputs[modelKey] ?? '';
    
    // Get the vega spec
    const vegaSpec = currentRun?.modelVegaSpecs?.[modelKey] ?? record.modelVegaSpecs?.[modelKey] ?? null;
    
    // Get the notional spec (extract from raw output if possible)
    let notionalSpec = '';
    try {
      const parsed = JSON.parse(rawOutput);
      if (parsed.content) {
        notionalSpec = JSON.stringify(parsed.content, null, 2);
      }
    } catch (e) {
      // If parsing fails, use raw output as notional spec
      notionalSpec = rawOutput;
    }
    
    // Get natural language response
    let naturalLanguageResponse = '';
    try {
      const parsed = JSON.parse(rawOutput);
      if (parsed.user_friendly_reply) {
        naturalLanguageResponse = parsed.user_friendly_reply;
      }
    } catch (e) {
      // If parsing fails, use raw output as natural language response
      naturalLanguageResponse = rawOutput;
    }
    
    return {
      rawOutput,
      vegaSpec: vegaSpec ? JSON.stringify(vegaSpec, null, 2) : '',
      notionalSpec,
      naturalLanguageResponse
    };
  };

  // Helper function to extract expected response data
  const extractExpectedResponseData = (record: EvaluationDataRecord) => {
    // Extract expected notional spec from expected_output
    let expectedNotionalSpec = '';
    let expectedNaturalLanguageResponse = '';
    
    try {
      if (record.expected_output) {
        expectedNotionalSpec = JSON.stringify(record.expected_output, null, 2);
      }
    } catch (e) {
      expectedNotionalSpec = 'Error parsing expected output';
    }
    
    // For expected natural language response, we'll use a placeholder for now
    // This would need to be extracted from the test case data if available
    // In the future, this could be enhanced to access the original test case data
    expectedNaturalLanguageResponse = 'Expected natural language response (not available in current data structure)';
    
    return {
      expectedNotionalSpec,
      expectedNaturalLanguageResponse
    };
  };

  // Helper function to extract metrics data
  const extractMetricsData = (record: EvaluationDataRecord, modelKey: string, runIndex: number | null) => {
    const runResults = record.run_results;
    const currentRun = runIndex !== null ? runResults?.[runIndex] : null;
    
    // Get metrics from current run or fallback to record metrics
    const metrics = currentRun?.metrics?.[modelKey] ?? record.metrics?.[modelKey] ?? {};
    
    // Get judge evaluations
    const judgeEvaluations = currentRun?.judge_evaluations ?? record.judge_evaluations ?? {};
    
    // Combine all metrics and judge evaluations into a single string
    const allMetrics = {
      ...metrics,
      ...Object.fromEntries(
        Object.entries(judgeEvaluations).flatMap(([judgeModel, modelEvals]) =>
          Object.entries(modelEvals[modelKey] ?? {}).map(([key, value]) => [
            `${judgeModel}_${key}`,
            value
          ])
        )
      )
    };
    
    return JSON.stringify(allMetrics, null, 2);
  };

  // Create CSV headers
  const headers = [
    '#',
    'Labels',
    'User Utterance',
    'Expected Response - Notional Spec',
    'Expected Response - Vega Spec',
    'Expected Response - Natural Language Response'
  ];

  // Add model-specific columns
  // Check if there are multiple runs available
  const hasMultipleRuns = evaluationData.length > 0 && 
    Object.keys(evaluationData[0].run_results ?? {}).length > 1;
  
  if (hasMultipleRuns) {
    // Multiple runs view - show data for each run
    const runIndices = evaluationData.length > 0 ? 
      Object.keys(evaluationData[0].run_results ?? {}).map(Number).sort((a, b) => a - b) : 
      [];
    
    runIndices.forEach(runIndex => {
      modelPromptKeys.forEach(modelKey => {
        const prettyName = prettyModelPromptName(modelKey);
        headers.push(`${prettyName} - Run ${runIndex + 1} - Raw Output`);
        headers.push(`${prettyName} - Run ${runIndex + 1} - Notional Spec`);
        headers.push(`${prettyName} - Run ${runIndex + 1} - Vega Spec`);
        headers.push(`${prettyName} - Run ${runIndex + 1} - Natural Language Response`);
        headers.push(`${prettyName} - Run ${runIndex + 1} - Metrics`);
      });
    });
  } else {
    // Single run view - show data for the current run
    modelPromptKeys.forEach(modelKey => {
      const prettyName = prettyModelPromptName(modelKey);
      headers.push(`${prettyName} - Raw Output`);
      headers.push(`${prettyName} - Notional Spec`);
      headers.push(`${prettyName} - Vega Spec`);
      headers.push(`${prettyName} - Natural Language Response`);
      headers.push(`${prettyName} - Metrics`);
    });
  }

  // Create CSV rows
  const rows = evaluationData.map(record => {
    const runIndex = getCurrentRunIndex(record);
    const expectedData = extractExpectedResponseData(record);
    
    // Base row data
    const row = [
      escapeCSV(record.test_number),
      escapeCSV(record.labels?.join(', ')),
      escapeCSV(record.input),
      // Expected response columns
      escapeCSV(expectedData.expectedNotionalSpec),
      escapeCSV(record.expectedVegaSpec ? JSON.stringify(record.expectedVegaSpec, null, 2) : ''),
      escapeCSV(expectedData.expectedNaturalLanguageResponse)
    ];

    // Add model-specific data
    // Check if there are multiple runs available for this record
    const hasMultipleRuns = Object.keys(record.run_results ?? {}).length > 1;
    
    if (hasMultipleRuns) {
      // Multiple runs view - show data for each run
      const runIndices = Object.keys(record.run_results ?? {}).map(Number).sort((a, b) => a - b);
      
      runIndices.forEach(runIdx => {
        modelPromptKeys.forEach(modelKey => {
          const vizData = extractVisualizationData(record, modelKey, runIdx);
          const metricsData = extractMetricsData(record, modelKey, runIdx);
          
          row.push(escapeCSV(vizData.rawOutput));
          row.push(escapeCSV(vizData.notionalSpec));
          row.push(escapeCSV(vizData.vegaSpec));
          row.push(escapeCSV(vizData.naturalLanguageResponse));
          row.push(escapeCSV(metricsData));
        });
      });
    } else {
      // Single run view - show data for the current run
      modelPromptKeys.forEach(modelKey => {
        const vizData = extractVisualizationData(record, modelKey, runIndex);
        const metricsData = extractMetricsData(record, modelKey, runIndex);
        
        row.push(escapeCSV(vizData.rawOutput));
        row.push(escapeCSV(vizData.notionalSpec));
        row.push(escapeCSV(vizData.vegaSpec));
        row.push(escapeCSV(vizData.naturalLanguageResponse));
        row.push(escapeCSV(metricsData));
      });
    }

    return row;
  });

  try {
    // Combine headers and rows
    const csvContent = [headers, ...rows]
      .map(row => row.join(','))
      .join('\n');

    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `evaluation_results_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up the URL object
    URL.revokeObjectURL(url);
    
    // Show success message
    message.success('CSV file downloaded successfully!');
  } catch (error) {
    console.error('Error generating CSV:', error);
    message.error('Failed to generate CSV file. Please try again.');
  }
};

const TestCaseEvaluation: React.FC = () => {
    // States for Settings Drawer
    const [drawerVisible, setDrawerVisible] = useState(true);
    //State to hold available test cases from backend 
    const [availableTestCases, setAvailableTestCases] = useState<string[]>([]);
    //State to hold which test cases have been selected 
    const [selectedTestCases, setSelectedTestCases] = useState<string[]>([]);
    // Free-form range/list the user types (e.g. "1-5, 8, 11-13")
    const [testRange, setTestRange] = useState<string>('');
    // State to hold the number of runs per instance, default is 3
    const [runsPerInstance, setRunsPerInstance] = useState<number>(3);
    //State to hold selected models
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    

    // Metrics drawer
    const [metricsDrawerVisible, setMetricsDrawerVisible] = useState(false);

    // States for the Datasource preview table 
    const [datasource, setDatasource] = useState<any[]>([]);
    const [datasourceDescription, setDatasourceDescription] = useState<string>('');
    const [isDatasourceExpanded, setIsDatasourceExpanded] = useState<boolean>(false);
    const [datasourceColumnDefs, setDatasourceColumnDefs] = useState<any[]>([]);
    
    // States for the Evaluation Results data table 

    const [loading, setLoading] = useState(false);


    // State variables to hold the datasource fields and data values for the nominal json spec to vegalite chart generation 
    const [datasourceFields, setDatasourceFields] = useState<DatasourceField[]>([]);
    const [dataValues, setDataValues] = useState<any[]>([]);
    const [evaluationData, setEvaluationData] = useState<EvaluationDataRecord[]>([]);
    /** Columns the user hid (key set) */
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    /** Columns the user chose to freeze (key set) */
    const [frozenColumns, setFrozenColumns] = useState<Set<string>>(new Set());
    const { token } = theme.useToken();

    // Judge model selection
    const [judgeModel, setJudgeModel] = useState<string | null>(null);
    // Recommended Judge based on LLM-as-Judge Best Practice
    const [recommendedJudge, setRecommendedJudge] = useState<string | null>(null);


    

    /* ---------- streaming progress bar ---------- */
    const [totalChunks,    setTotalChunks]    = useState(0);   // denominator
    const [receivedChunks, setReceivedChunks] = useState(0);   // numerator
    const progressPct = totalChunks ? (receivedChunks / totalChunks) * 100 : 0;

    /* ------------------------------------------------------------
       Helper: return a plain label for a column.  `title` can be:
       • string / number      → render as-is
       • ReactNode            → render as-is
       • (props)=>ReactNode   → fall back to the column key
    ------------------------------------------------------------ */
    const colLabel = useCallback(
      (c: ColumnType<EvaluationDataRecord> | ColumnGroupType<EvaluationDataRecord>): React.ReactNode =>
        typeof c.title === 'string' || typeof c.title === 'number'
          ? c.title
          : (c.key as string),
      []
    );
    

  // state to hold the prompts for the prompt list 
  const [prompts, setPrompts] = useState<Prompt[]>([{ id: uuid(), text: defaultSystemPrompt }]);

  // states to upload the test cases and datasource yaml files 
  const [uploadedDatasource, setUploadedDatasource] = useState<string | null>(null);
  const [uploadedTestCases, setUploadedTestCases]   = useState<string | null>(null);
  // state for uploading status: when the user clicks the upload button and false when the upload is complete or fails
  const [uploading, setUploading]          = useState(false);
  // state to hold the upload progress percentage 0 to 100
  const [uploadPercent,   setUploadPercent]   = useState(0);
  // states to hold the uploaded test case files
  const [uploadedCaseFile , setUploadedCaseFile ] = useState<string | null>(null);
  // state to hold the uploaded datasource file
  const [uploadedDsFile   , setUploadedDsFile   ] = useState<string | null>(null);

  // state to show the datasource example
  const [showDsExample , setShowDsExample ] = useState(false);
  // state to show the test case example
  const [showTcExample , setShowTcExample ] = useState(false);
  // state to see if the evaluation is in progress and we have results to display
  const [evaluating, setEvaluating] = useState(false);
  // state to check if the metrics are ready to be displayed
  const [metricsReady, setMetricsReady] = useState(false);
  // State for CSV download loading
  const [csvDownloadLoading, setCsvDownloadLoading] = useState(false);


 // streaming state from the hook (job + events path)
  const { state: streamState, start: startStream, cancel: cancelStream } = useEvaluationStream();
// progress is still shown with local bars; we'll sync from streamState


/** UI stages:
 * 0 = splash only
 * 1 = datasource uploaded  → preview table of the datasource
 * 2 = test-cases uploaded → four-column preview of cases
 * 3 = evaluation finished → full table & overview cards
 */
const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);

/** Raw test-case list (parsed YAML) */
const [previewCases, setPreviewCases] = useState<any[]>([]);

/** Rows we feed to <Table> when we have no evaluation results yet */
const [previewRows, setPreviewRows] = useState<EvaluationDataRecord[]>([]);

// All unique labels across whichever rows are visible
const allLabels = useMemo(() => {
  const rows = stage >= 3 ? evaluationData : previewRows;
  const set = new Set<string>();
  rows.forEach(r => r.labels?.forEach(l => set.add(l)));
  return Array.from(set).sort();
}, [stage, evaluationData, previewRows]);

  // states to hold api keys 
  const [userId, setUserId] = useState<string>('');
  const [userApiKeys, setUserApiKeys] = useState({
  OPENAI_API_KEY:      '',
  ANTHROPIC_API_KEY:   '',
  SALESFORCE_API_KEY:  '',
  EINSTEIN_API_KEY:    ''
  });

// Example data source file snippet
const DS_SNIPPET = `title: Bike Sales 2023
datasourceFields:
  - name: Region
    data: string
    fieldValues: [East, West, North, South]
  - name: Sales
    data: number
    fieldValues: [5230, 4180, 6100, 3520]`;
// Example test case file snippet
const TC_SNIPPET = `- test-number: 1
  description: Total sales by region
  utterances:
    - canonical: "Show total sales per region"
      notional-spec-out:
        version: "0.2.0"
        fields:
          - caption: Region
            data: string
            role: dimension
            type: discrete
          - caption: Sales
            data: number
            role: measure
            type: continuous
            aggregation: sum`;

  // State to hold the status of each API key
  const [keyStatus] = useState<ApiKeyStatusMap>({});
  // State to hold the source of each API key (env, user, missing)
  const [keySource] = useState<Record<string, KeySrc>>({});
  // State to track expanded rows for preview table
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // Global state for synchronized run selection across all metric cells
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(0); // start on run 0
  const [showSpecificRun, setShowSpecificRun] = useState<boolean>(true); // start in "runs" view

  // State to hold the metric checks for visualization, natural language, and spec metrics 
  // Initialize with all metrics checked 
  const [metricChecks, setMetricChecks] = useState<Record<string, boolean>>(
    () => Object.fromEntries(
          [...VIZ_METRICS, ...NL_METRICS, ...SPEC_METRICS]
            .map(k => [k, true])
        ) as Record<string, boolean>
  );
  // derive the *enabled* metric IDs once per render 
  const enabledMetrics = useMemo<string[]>(
    () => Object.keys(metricChecks).filter(k => metricChecks[k]),
    [metricChecks]
  );

  const prfEnabled = useMemo(
    () => ({
      precision: !!metricChecks.precision,
      recall:    !!metricChecks.recall,
      f1:        !!metricChecks.f1,
    }),
    [metricChecks.precision, metricChecks.recall, metricChecks.f1]
  );

  // Function to toggle a metric check
  const toggleMetric = (key: string, checked: boolean) =>
    setMetricChecks(prev => ({ ...prev, [key]: checked }));

  // Handle row expansion/collapse for preview table
  const handleRowExpand = (record: EvaluationDataRecord) => {
    if (stage === 2 && record.children && record.children.length > 0) {
      setExpandedRows(prev => {
        const newSet = new Set(prev);
        if (newSet.has(record.key)) {
          newSet.delete(record.key);
        } else {
          newSet.add(record.key);
        }
        return newSet;
      });
    }
  };

  // Handle run navigation for synchronized metric cells
  const handleRunNavigation = (direction: 'prev' | 'next') => {
    if (!showSpecificRun || selectedRunIndex === null) return;
    
    const maxRuns = evaluationData.length > 0 ? 
      Object.keys(evaluationData[0].run_results ?? {}).length : 0;
    
    if (direction === 'prev' && selectedRunIndex > 0) {
      setSelectedRunIndex(selectedRunIndex - 1);
    } else if (direction === 'next' && selectedRunIndex < maxRuns - 1) {
      setSelectedRunIndex(selectedRunIndex + 1);
    }
  };

  // Handle toggle between averaged and specific run view
  const handleToggleRunView = () => {
    if (showSpecificRun) {
      // Switch back to averaged view
      setShowSpecificRun(false);
      setSelectedRunIndex(null);
    } else {
      // Switch to specific run view (start with representative run)
      const representativeRun = evaluationData.length > 0 ? 
        evaluationData[0].representative_run_idx ?? 0 : 0;
      setShowSpecificRun(true);
      setSelectedRunIndex(representativeRun);
    }
  };

  // Get the current run index to pass to components
  const getCurrentRunIndex = (record: EvaluationDataRecord) => {
    if (!showSpecificRun || selectedRunIndex === null) {
      return undefined; // Use averaged metrics
    }
    return selectedRunIndex;
  };

  // Memoize the model prompt keys to avoid unnecessary recalculations
  // This will create a unique key for each model and prompt combination
  // e.g., "model1|prompt1", "model1|prompt2", etc
    const modelPromptKeys = useMemo(
    () =>
      selectedModels.flatMap(m =>
        prompts.map((_, i) => `${m}|prompt${i + 1}`)
      ),
    [selectedModels, prompts]
  );

const fetchTestCases = async () => {
  const res = await axios.get<string[]>(`${API_BASE}/get-test-cases`);
  setAvailableTestCases(res.data);
};



/** Push the datasource JSON into every bit of state the preview needs */
const populateDatasourcePreview = (ds: any) => {
  const datasourceFields = ds.datasourceFields || [];
  const description      = ds.description || 'No description available';

  /* ---------- rows ---------- */
  const fieldNames  = datasourceFields.map((f: any) => f.name);
  const valueArrays: (any[])[] =
    datasourceFields.map((f: any) => f.fieldValues || []);

  const lengths = valueArrays.map((arr: any[]) => arr.length);
  const maxRows = lengths.length ? Math.max(...lengths) : 0;

  const rows = Array.from({ length: maxRows }, (_, r) => {
    const row: Record<string, any> = { key: r };
    fieldNames.forEach((name: string, i: number) => {
      row[name] = valueArrays[i][r] ?? null;
    });
    return row;
  });

  /* ---------- column defs ---------- */
  const cols = fieldNames.map((name: string) => ({
    title: name,
    dataIndex: name,
    key: name,
    width: 150,
    render: (txt: any) => (
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {txt}
      </div>
    ),
  }));

 

  /* ---------- push into state ---------- */
  setDatasource(rows);
  setDatasourceColumnDefs(cols);
  setDatasourceDescription(description);
  setDatasourceFields(datasourceFields);
  setDataValues(rows);
};



useEffect(() => {
  if (!uploadedDatasource || !uploadedTestCases) return;

  setUploading(true);
  setUploadPercent(0);                    // reset bar

  axios.post(
    `${API_BASE}/upload-custom-assets`,
    { datasourceYaml: uploadedDatasource,
      testCaseYaml:   uploadedTestCases },
    {
      // this callback fires for every chunk the browser streams out
      onUploadProgress: evt => {
        if (!evt.total) return;           // safety
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setUploadPercent(pct);
      }
    }
  )
  .then(res => {
    const { is_duplicate, testCaseFile, datasourceFile, meta, existing_test_case_file, existing_datasource_file, message: duplicateMessage } = res.data;
    
    if (is_duplicate) {
      // Handle duplicate case - show message and select existing file
      message.info(duplicateMessage || 'This file already exists. The existing file has been selected automatically.');
      
      // Set the existing files as uploaded
      setUploadedCaseFile(existing_test_case_file);
      setUploadedDsFile(existing_datasource_file);
      setIsDatasourceExpanded(true);
      
      // Refresh test cases and select the existing one
      fetchTestCases().then(() => handleTestCaseChange([existing_test_case_file]));
    } else {
      // Handle new file upload
      message.success('Uploaded files successfully registered!');
      setUploadedCaseFile(testCaseFile);
      setUploadedDsFile(datasourceFile);
      setIsDatasourceExpanded(true); // Auto-open datasource panel after successful upload

      /* -----------------------------------------------------------
         Inject a brand-new entry into the in-memory mapping so
         UI tags (title / difficulty / domain) work instantly.
         `testCaseMapping` is imported from ./constants and is
         a plain JS object, so mutating it here is fine.
      ----------------------------------------------------------- */
      (testCaseMapping as any)[testCaseFile] = {
        title:      meta.title,
        difficulty: meta.difficulty,
        domain:     meta.domain
      };

      // fetch datasource immediately so the table shows up
      axios.get(`${API_BASE}/get-datasource?test_case=${encodeURIComponent(testCaseFile)}`)
           .then(r => populateDatasourcePreview(r.data));

      // now refresh list & select the case (this still fires your onChange)
      fetchTestCases().then(() => handleTestCaseChange([testCaseFile]));
    }
  })
  .catch(err => {
    // Modal.error({
    //   title: 'Server rejected YAML',
    //   content: err.response?.data?.error || err.message
    // });
    setUploadedDatasource(null);
    setUploadedTestCases(null);
  })
  .finally(() => {
    setUploading(false);
    setUploadPercent(0);                 
  });
}, [uploadedDatasource, uploadedTestCases]);




  useEffect(() => {
        // Fetch available test cases from the backend and show them in the Settings Drawer
        axios.get(`${API_BASE}/get-test-cases`)
            .then((response) => {
                setAvailableTestCases(response.data);
            })
            .catch((error) => {
                console.error("Error fetching test cases", error);
            });
    }, []);

    // Derive the mapping for the selected test case:
    const selectedTestCaseMapping = selectedTestCases.length > 0 ? testCaseMapping[selectedTestCases[0]] : null;

  // Fetch datasource fields and data when a test case is selected// get data field values and data from the datasource
  useEffect(() => {
        if (selectedTestCases.length > 0) {
          const testCase = selectedTestCases[0];
          const url = buildDatasourceURL(testCase);

          axios.get(url)
            .then((response) => {
              const datasource = response.data;
              setDatasourceFields(datasource.datasourceFields || []);
              setDataValues(datasource.dataValues || []);
            })
            .catch((error) => {
              console.error('Error fetching datasource:', error);
            });
        }
     }, [selectedTestCases, uploadedDsFile]);

    
  useEffect(() => {
      if (!showSpecificRun) return;
      const rep = evaluationData[0]?.representative_run_idx;
      if (typeof rep === 'number' && rep !== selectedRunIndex) {
        setSelectedRunIndex(rep);
      }
    }, [showSpecificRun, evaluationData]);
  
/** Safe JSON.parse – returns undefined on failure (single source of truth) */
function safeJsonParse<T = unknown>(payload: unknown): T | undefined {
  if (typeof payload !== 'string') return undefined;
  try { return JSON.parse(payload); }
  catch { return undefined; }
}


const handleDatasourceAccepted = (yaml: string) => {
  setUploadedDatasource(yaml);
  const dsObj = YAML.load(yaml) as { datasourceFields?: any[]; description?: string };
  populateDatasourcePreview(dsObj);
  if (stage < 1) setStage(1);
};

const handleTestcaseAccepted = (yaml: string) => {
  try {
    setUploadedTestCases(yaml);
    const cases = YAML.load(yaml) as any[];
    setPreviewCases(cases);
    if (stage < 2) setStage(2);
  } catch (e:any) {
    Modal.error({ title: "Invalid Test Case YAML", content: String(e?.message || e) });
  }
};




/* ---------- sync progress bar from stream state ---------- */
useEffect(() => {
  // Use fragment count for more granular progress when granular streaming is enabled
  if (streamState.granular && streamState.fragments.length > 0) {
    setTotalChunks(streamState.total || 0);
    setReceivedChunks(streamState.fragments.length);
  } else {
    setTotalChunks(streamState.total || 0);
    setReceivedChunks(streamState.completed || 0);
  }
  
  // Update evaluating/loading state based on stream status
  if (streamState.status === 'running') {
    setEvaluating(true);
    setLoading(true);
  } else if (streamState.status === 'done' || streamState.status === 'error' || streamState.status === 'idle') {
    setEvaluating(false);
    setLoading(false);
  }
  }, [streamState.total, streamState.completed, streamState.status, streamState.granular, streamState.fragments.length]);

  // Log evaluation results when job completes
  useEffect(() => {
    if (streamState.status === 'done' && evaluationData.length > 0) {
      // previously logged evaluation_results locally – removed per request
    } else if (streamState.status === 'error' && streamState.error) {
      // previously logged evaluation_error locally – removed per request
    }
  }, [streamState.status, streamState.error, evaluationData, selectedModels, selectedTestCases, enabledMetrics]);

/* ---------- utility function to check if judge evaluations are loading ---------- */
const isJudgeEvaluationLoading = useCallback((rowId: string, modelKey: string) => {
  // Find the evaluation record for this row
  const record = evaluationData.find(r => (r.row_id ?? '').replace(/\|run\d+$/, '') === rowId.replace(/\|run\d+$/, ''));
  
  if (!record || !judgeModel || streamState.status !== 'running') {
    return false;
  }
  
  // Check if we have a model response but no judge evaluation yet
  const hasModelResponse = record.model_outputs?.[modelKey];
  const hasJudgeEvaluation = record.judge_evaluations?.[judgeModel]?.[modelKey];
  
  // If we have a model response but no judge evaluation, show loading
  return hasModelResponse && !hasJudgeEvaluation;
}, [evaluationData, judgeModel, streamState.status]);

/* ---------- merge streamed cells into table rows ---------- */
useEffect(() => {
  if (!streamState.cells || !Object.keys(streamState.cells).length) return;
  // derive the enabled metric ids locally so we don't depend on declaration order
  const enabled = Object.keys(metricChecks).filter(k => (metricChecks as any)[k]);
  setEvaluationData(prev => {
    const next = [...prev];

    for (const [rowId, modelMap] of Object.entries(streamState.cells)) {
      const baseId = rowId.replace(/\|run\d+$/, '');
      const runMatch = rowId.match(/\|run(\d+)$/);
      const runIdx = runMatch ? Number(runMatch[1]) : undefined;

      const i = next.findIndex(r => (r.row_id ?? '').replace(/\|run\d+$/, '') === baseId);
      if (i < 0) continue;
      const rec = { ...next[i] };

      rec.model_outputs = { ...(rec.model_outputs ?? {}) };
      rec.modelVegaSpecs = { ...(rec.modelVegaSpecs ?? {}) };
      rec.modelConversionErrors = { ...(rec.modelConversionErrors ?? {}) };
      rec.metrics = { ...(rec.metrics ?? {}) };
      rec.run_results = rec.run_results ?? {};
      if (runIdx !== undefined) {
        rec.run_results[runIdx] = rec.run_results[runIdx] || {
          model_outputs: {},
          modelVegaSpecs: {},
          modelConversionErrors: {},
          metrics: {},
          judge_evaluations: {},
        };
      }

      for (const [modelKey, cell] of Object.entries(modelMap)) {
        const raw = cell.output;
        rec.model_outputs[modelKey] = raw;

        const parsedRaw = safeJsonParse<any>(raw);
        const notional  = parsedRaw?.content ?? parsedRaw; // notional spec
        const conv = convertNotionalSpecToVegaSpec(
          notional,
          datasourceFields,
          dataValues
        );
        rec.modelVegaSpecs[modelKey]        = conv.vegaSpec;
        rec.modelConversionErrors[modelKey] = conv.errors;

        const expectedNL = (rec.expected_output as any)?.user_friendly_reply ?? '';
        const actualNL   = parsedRaw?.user_friendly_reply ?? '';
        const computed   = computeMetrics(
          notional,
          rec.expected_output,
          conv.vegaSpec,
          rec.expectedVegaSpec,
          datasourceFields,
          dataValues,
          expectedNL,
          actualNL,
          enabled
        );
        rec.metrics[modelKey] = computed;

        if (runIdx !== undefined) {
                    const rr = rec.run_results[runIdx]!;
                    // make sure nested maps exist
                    rr.model_outputs           = rr.model_outputs           ?? {};
                    rr.modelVegaSpecs          = rr.modelVegaSpecs          ?? {};
                    rr.modelConversionErrors   = rr.modelConversionErrors   ?? {};
                    rr.metrics                 = rr.metrics                 ?? {};
          
                    rr.model_outputs[modelKey]          = raw;
                    rr.modelVegaSpecs[modelKey]         = conv.vegaSpec;
                    rr.modelConversionErrors[modelKey]  = conv.errors;
                    rr.metrics[modelKey]                = computed;
          if (cell.judge) {
            rr.judge_evaluations = rr.judge_evaluations || {};
            const bucketKey = judgeModel || '__judge__';           // <-- use selected judge when set
            (rr.judge_evaluations as any)[bucketKey] = (rr.judge_evaluations as any)[bucketKey] || {};
            (rr.judge_evaluations as any)[bucketKey][modelKey] = cell.judge;
          }
        }
      }

      // When all runs arrived → compute averages + representative run
      if (Object.keys(rec.run_results).length === runsPerInstance) {
        const modelsArr = modelPromptKeys;
        const avg: ModelMetricsMap = {};

        modelsArr.forEach(m => {
          const list: MetricScores[] = [];
          for (const r of Object.values(rec.run_results!)) {
            if ((r as any).metrics?.[m]) list.push((r as any).metrics[m]);
          }
          const baseMetrics = averageMetrics(list);
          const aggregated = baseMetrics as MetricScores & {
            overall: number;
            buckets: ReturnType<typeof computeVisualizationSubcategoryScores>;
          };
          aggregated.overall = computeOverallVisualizationScore(baseMetrics, enabled);
          aggregated.buckets = computeVisualizationSubcategoryScores(baseMetrics, enabled);
          avg[m] = aggregated;
        });
        rec.metric_averages = avg;

        let bestIdx = 0, bestScore = Number.NEGATIVE_INFINITY;
        for (const [rIdxStr, rBlob] of Object.entries(rec.run_results)) {
          const rIdx = Number(rIdxStr);
          let tot = 0, cnt = 0;
          modelPromptKeys.forEach(m => {
            const ms = (rBlob as any).metrics?.[m];
            if (ms) { tot += computeOverallVisualizationScore(ms, enabled); cnt += 1; }
          });
          const mean = cnt ? tot / cnt : 0;
          if (mean > bestScore) { bestScore = mean; bestIdx = rIdx; }
        }
        rec.representative_run_idx = bestIdx;
        const rep = rec.run_results[bestIdx] as any;
        rec.model_outputs         = rep.model_outputs;
        rec.modelConversionErrors = rep.modelConversionErrors ?? {};
        rec.metrics               = rep.metrics ?? {};
        rec.judge_evaluations     = rep.judge_evaluations ?? {};
      }

      next[i] = rec;
    }
    return next;
  });
}, [streamState.cells, datasourceFields, dataValues, metricChecks, runsPerInstance, modelPromptKeys, judgeModel]);


useEffect(() => {
  if (selectedModels.length === 0) return;

  /** family of every selected generation model                      */
  const genFamilies = new Set(selectedModels.map(m=>modelFamily[m]??'__unknown__'));

  /** first candidate that is (a) not in generation list and  
   *  (b) from a different family                                  */
  const candidate = judgeStrengthOrder.find(
    m =>
      !selectedModels.includes(m) &&
      !genFamilies.has(modelFamily[m] ?? '__unknown__')
  ) ?? null;
  setRecommendedJudge(candidate);
}, [selectedModels]);


function normaliseParaphrases(tc: TestCase): string[] {
  if (tc.paraphrases?.length) return tc.paraphrases;
  if (tc.paraphrase && Array.isArray(tc.paraphrase)) return tc.paraphrase;
  if (typeof tc.paraphrase === 'string' && tc.paraphrase.trim())
    return [tc.paraphrase];
  return [];
}

/** Build one EvaluationDataRecord from a single utterance */
function makeRow(
  utterance: any,
  tc: any,
  idx: number,
  keyPrefix = 'preview'
): EvaluationDataRecord {
  const pArr      = normaliseParaphrases(utterance);
  const testNum   = tc['test-number'] ?? tc.test_number ?? idx + 1;
  const expected = utterance.expected_output      
                ?? utterance['notional-spec-out'] // ← YAML preview
                ?? {};

  const conv      = convertNotionalSpecToVegaSpec(
                      expected, datasourceFields, dataValues);

  return {
    key                   : `${keyPrefix}-${testNum}-${idx}`,
    idx,  
    file                  : tc.file ?? '',  
    test_number           : testNum,
    labels                : utterance.labels ?? [],
    input                 : pArr[0] ?? utterance.canonical ?? '',
    canonical             : utterance.canonical,
    paraphrases           : pArr,
    expected_output       : expected,
    expectedVegaSpec      : conv.vegaSpec,
    expectedErrors        : conv.errors,
    model_outputs         : {},
    modelVegaSpecs        : {},
    modelConversionErrors : {},
    metrics               : {},
    pass_fail             : {},
    expanded              : false,
  };
}


const buildPreviewRows = useCallback((list: any[]) => {
  return list.flatMap(tc =>
    tc.utterances.map((ut: any, i: number) =>
     makeRow(ut, tc, i, 'preview')
    )
  );
}, [datasourceFields, dataValues]);

// Check if *all model outputs* have arrived (cards can render as soon as
// every output finished streaming – we don't wait for every metric object)
const areAllMetricsReady = (
  rows: EvaluationDataRecord[],   // ← put the types back
  keys: string[]                  // ← …
): boolean =>
  rows.every((r: EvaluationDataRecord) =>
    keys.every((k: string) =>
      Boolean(r.model_outputs?.[k]) && r.model_outputs![k] !== '__pending__'
    )
  );
// Check if all metrics are ready for the current evaluation data and model prompt keys  
useEffect(() => {
  setMetricsReady(areAllMetricsReady(evaluationData, modelPromptKeys));
}, [evaluationData, modelPromptKeys]);


useEffect(() => {
  if (stage === 2 && previewCases.length && datasourceFields.length) {
    setPreviewRows(buildPreviewRows(previewCases));
  }
}, [stage, previewCases, datasourceFields, buildPreviewRows]);






// Disable NL check-boxes when Judge model unpicked
useEffect(() => {
  /* Never allow the judge to appear in the generation list. */
  setSelectedModels(prev => prev.filter(m => m !== judgeModel));

  /* Update NL check-boxes according to judge presence.*/
  setMetricChecks(prev => {
    const next = { ...prev };

    if (!judgeModel) {
      // No judge: disable every NL metric *except* Info-Equivalence
     NL_METRICS.forEach(k => {
        if (k !== 'information_similarity') next[k] = false;
      });
    } else {
      // Judge selected: enable the full NL set
      NL_METRICS.forEach(k => { next[k] = true; });
    }
    return next;
  });
}, [judgeModel]);


useEffect(() => {
  if (receivedChunks === totalChunks && totalChunks > 0) {
    setMetricsReady(true);        // safety net
  }
}, [receivedChunks, totalChunks]);


    // 1) Sort by test_number in ascending order using useMemo
  const sortedData = useMemo(() => {
    return [...evaluationData].sort((a, b) => {
      const aNum = Number(a.test_number) || 0;
      const bNum = Number(b.test_number) || 0;
      return aNum - bNum;
    });
  }, [evaluationData]);

  // cache a flat, ordered list that includes *every* utterance row
  const flatRows = sortedData;

  // 2) Group data
  const groupedData = useMemo(() => {
    return groupByTestNumber(sortedData);
  }, [sortedData]);

  // 3) Group preview data for consistent UI
  const groupedPreviewData = useMemo(() => {
    const grouped = groupByTestNumber(previewRows);
    // Add expanded state to grouped data and include children when expanded
    return grouped.flatMap(record => {
      const expanded = expandedRows.has(record.key) || false;
      const baseRecord = {
        ...record,
        expanded
      };
      
      if (expanded && record.children && record.children.length > 0) {
        // Return parent + children
        return [baseRecord, ...record.children.map(child => ({
          ...child,
          expanded: false // Children don't have expand state
        }))];
      } else {
        // Return just parent
        return [baseRecord];
      }
    });
  }, [previewRows, expandedRows]);
    
  // Dynamically assign a CSS class to each <tr> based on the row's data and index.
  const rowClassName = (record: EvaluationDataRecord, _unusedIndex: number): string => {
    // For evaluation results (stage >= 3)
    if (stage >= 3) {
      // Find the top-level index of `record` in groupedData
      const topLevelIndex = groupedData.indexOf(record);
      
      // If `record` is not found in groupedData (-1), 
      // it must be a child row → no chunk divider.
      if (topLevelIndex === -1) {
        return '';
      }
      
      // If the parent row is the first in groupedData, no divider
      if (topLevelIndex === 0) {
        return '';
      }
      
      // Only show chunk divider if this is a parent row (not a child/turn)
      // and if it's a different test case (different file or test_number)
      const prevRecord = groupedData[topLevelIndex - 1];
      if (record.key === groupedData[topLevelIndex].key && // Only for parent rows
          (record.file !== prevRecord.file || record.test_number !== prevRecord.test_number)) {
        return 'chunk-divider';
      }
    }
    // For preview data (stage === 2)
    else if (stage === 2) {
      // Get the original grouped data (without children) for chunk divider logic
      const originalGrouped = groupByTestNumber(previewRows);
      const parentRecord = originalGrouped.find(parent => 
        parent.key === record.key || 
        (parent.children && parent.children.some(child => child.key === record.key))
      );
      
      if (!parentRecord) return '';
      
      // Find the index of this parent in the original grouped data
      const parentIndex = originalGrouped.indexOf(parentRecord);
      
      // If the parent row is the first, no divider
      if (parentIndex === 0) {
        return '';
      }
      
      // Only show chunk divider if this is a parent row (not a child/turn)
      // and if it's a different test case (different file or test_number)
      const prevParent = originalGrouped[parentIndex - 1];
      if (record.key === parentRecord.key && // Only for parent rows
          (parentRecord.file !== prevParent.file || parentRecord.test_number !== prevParent.test_number)) {
        return 'chunk-divider';
      }
    }
    
    return '';
  }; 
  
// Function to compute the average visualization metrics for each model
const vizAvgRecord = useMemo(() => {
  // if (!metricsReady) return makeEmptyRecord('viz-avg');
  const rec = makeEmptyRecord('viz-avg');

  modelPromptKeys.forEach(model => {
    (rec.metrics as Record<string, MetricScores>)[model] =
  averageVisualizationMetrics(evaluationData, model, enabledMetrics) as unknown as MetricScores;

  });

  return rec;
}, [evaluationData, modelPromptKeys, enabledMetrics, metricsReady]);

interface NLBuckets {
  analytical     : number;  
  conversational : number;   
  factual        : number;  
}
interface ModelNLAverages {
  overall : number;          
  buckets : Partial<NLBuckets>; 
  subs    : Record<JudgeScoreKey, number>;
}

/* Natural-language bucket [0–100] helper */
const MAX_STARS          = 5;  // 1–5 stars for each metric
const MAX_BUCKET_SCORE   = 100;

function starsToPct(stars: number) {
  return (stars / MAX_STARS) * MAX_BUCKET_SCORE;
}


/**
 * Aggregate NL judge metrics, respecting the "enabled" list that comes
 * from the Metrics selector UI.
 *
 * @param records     all utterance-level rows
 * @param model       the generation model we are averaging for
 * @param judgeModel  the judge model key
 * @param enabled     the checkbox IDs that are ON
 */
function averageNaturalLanguageMetrics(
  records    : EvaluationDataRecord[],
  model      : string,
  judgeModel : string,
  enabled    : string[]
): ModelNLAverages {

  /* helper ------------------------------------------------------ */
  const on = (k: string) => enabled.includes(k);

  /* accumulators ------------------------------------------------ */
  let sumAssum = 0, cntAssum = 0;
  let sumIns   = 0, cntIns   = 0;
  let sumCoh   = 0, cntCoh   = 0;
  let sumFur   = 0, cntFur   = 0;
  let sumInfo  = 0, cntInfo  = 0;

  records.forEach(rec => {
    const judgeBucket =
      (rec.judge_evaluations as any)?.[judgeModel] ??
      (rec.judge_evaluations as any)?.__judge__;

    const judge = judgeBucket?.[model];
    const ms    = rec.metrics?.[model];

    if (judge) {
      if (judge.assumptions        !== undefined) { sumAssum += judge.assumptions;        cntAssum++; }
      if (judge.insightfulness     !== undefined) { sumIns   += judge.insightfulness;     cntIns++;   }
      if (judge.coherence          !== undefined) { sumCoh   += judge.coherence;          cntCoh++;   }
      if (typeof judge.follow_up_relevance === 'number') {
        sumFur += judge.follow_up_relevance;
        cntFur++;
      }
    }
    if (ms?.information_similarity !== undefined) {
      sumInfo += ms.information_similarity * 100;   // convert once here
      cntInfo++;
    }
  });

  /* per-metric means ------------------------------------------- */
  const avgAssum    = cntAssum ? sumAssum / cntAssum : 0;
  const avgInsight  = cntIns   ? sumIns   / cntIns   : 0;
  const avgCoh      = cntCoh   ? sumCoh   / cntCoh   : 0;
  const avgFollowUp = cntFur   ? sumFur   / cntFur   : 0;
  const avgInfoEq   = cntInfo  ? sumInfo  / cntInfo  : 0;

  /* ----- bucket construction (only when at least one metric ON) */
  const buckets: Partial<NLBuckets> = {};

  if (on('assumptions') || on('insightfulness')) {
    const stars =
      ((on('assumptions')    ? avgAssum   : 0) +
       (on('insightfulness') ? avgInsight : 0)) /
      ( (on('assumptions') ? 1 : 0) + (on('insightfulness') ? 1 : 0) || 1 );

    buckets.analytical = starsToPct(stars);
  }

  if (on('coherence') || on('follow_up_relevance')) {
    const parts: number[] = [];
    if (on('coherence')) parts.push(avgCoh);
    /* Skip follow‑up relevance when no score is present (e.g. first turn) */
    if (on('follow_up_relevance') && cntFur) parts.push(avgFollowUp);

    if (parts.length) {
      buckets.conversational = starsToPct(
        parts.reduce((a, b) => a + b, 0) / parts.length
      );
    }
  }

  if (on('information_similarity')) {
    buckets.factual = avgInfoEq;            // already 0-100 %
  }

  /* ----- overall = mean of PRESENT buckets -------------------- */
  const bucketValues = Object.values(buckets);
  const overallPct   = bucketValues.length
                     ? bucketValues.reduce((a,b)=>a+b,0) / bucketValues.length
                     : 0;

  /* sub-metric star cache (always raw 0-5) ---------------------- */
  const subs: Record<JudgeScoreKey, number> = {
    assumptions        : avgAssum,
    insightfulness     : avgInsight,
    coherence          : avgCoh,
    follow_up_relevance: avgFollowUp,
  };

  return {
    overall: overallPct,
    buckets,
    subs
  };
}

/**
 * Aggregate only information similarity metrics when no judge model is selected.
 * This function computes averages for information similarity across all records.
 *
 * @param records     all utterance-level rows
 * @param model       the generation model we are averaging for
 * @param enabled     the checkbox IDs that are ON
 */
function averageInformationSimilarityOnly(
  records    : EvaluationDataRecord[],
  model      : string,
  enabled    : string[]
): ModelNLAverages {

  /* helper ------------------------------------------------------ */
  const on = (k: string) => enabled.includes(k);

  /* accumulators ------------------------------------------------ */
  let sumInfo  = 0, cntInfo  = 0;

  records.forEach(rec => {
    const ms = rec.metrics?.[model];

    if (ms?.information_similarity !== undefined) {
      sumInfo += ms.information_similarity * 100;   // convert once here
      cntInfo++;
    }
  });

  /* per-metric means ------------------------------------------- */
  const avgInfoEq   = cntInfo  ? sumInfo  / cntInfo  : 0;

  /* ----- bucket construction (only when information_similarity is ON) */
  const buckets: Partial<NLBuckets> = {};

  if (on('information_similarity')) {
    buckets.factual = avgInfoEq;            // already 0-100 %
  }

  /* ----- overall = mean of PRESENT buckets -------------------- */
  const bucketValues = Object.values(buckets);
  const overallPct   = bucketValues.length
                     ? bucketValues.reduce((a,b)=>a+b,0) / bucketValues.length
                     : 0;

  /* sub-metric star cache (empty when no judge) ---------------------- */
  const subs: Record<JudgeScoreKey, number> = {
    assumptions        : 0,
    insightfulness     : 0,
    coherence          : 0,
    follow_up_relevance: 0,
  };

  return {
    overall: overallPct,
    buckets,
    subs
  };
}

// Compute the average natural language metrics for each model
const nlAvgRecord = useMemo(() => {
  // if (!metricsReady) return makeEmptyRecord('nl-avg');
  const rec = makeEmptyRecord('nl-avg');

  modelPromptKeys.forEach(model => {
    if (judgeModel) {
      // When judge model is selected, use full natural language metrics
      rec.metrics![model] = averageNaturalLanguageMetrics(
        evaluationData,
        model,
        judgeModel,
        enabledMetrics        
      ) as unknown as MetricScores;
    } else {
      // When no judge model is selected, only compute information similarity
      rec.metrics![model] = averageInformationSimilarityOnly(
        evaluationData,
        model,
        enabledMetrics        
      ) as unknown as MetricScores;
    }
  });

  return rec;
}, [evaluationData, modelPromptKeys, judgeModel, enabledMetrics, metricsReady]);

// Compute the average F1 score across all models
const f1AvgRecord = useMemo(() => {
  // if (!metricsReady) return makeEmptyRecord('f1-avg');
  const rec: EvaluationDataRecord = {
    key: 'acc-avg',
    input:'', canonical:'', paraphrases:[],
    expected_output:{}, model_outputs:{},
    metrics:{},
  } as any;

  modelPromptKeys.forEach(m => {
    let prec=0, recall=0, f1=0, cnt=0;
    evaluationData.forEach(row => {
      const s = row.metrics?.[m]?.score_precision_recall_f1;
      if (!s) return;
      prec  += s.precision;
      recall+= s.recall;
      f1    += s.f1;
      cnt   += 1;
    });
    if (cnt===0) cnt=1;
    rec.metrics![m] = {
      score_precision_recall_f1: {
        precision: prec/cnt,
        recall:    recall/cnt,
        f1:        f1/cnt,
      },
    } as any;
  });
  return rec;
}, [evaluationData, modelPromptKeys, metricsReady]);

// Recommendation for the top model based on visualization scores
// This is used to highlight the best-performing model in the UI
const topModel = useMemo(() => {
  if (evaluationData.length === 0) return null;
  // choose highest overall visualisation score
  let best = null, bestScore = -1;
  modelPromptKeys.forEach(m => {
    const s = (vizAvgRecord.metrics?.[m] as any)?.overall ?? 0;
    if (s > bestScore) { bestScore = s; best = m; }
  });
  return best;
}, [vizAvgRecord, modelPromptKeys, evaluationData]);


async function fetchAndPreviewCases(filename: string) {
  /* When the file was uploaded in this session the backend does NOT
     know it yet – we already hold the raw YAML locally. */
  if (filename === uploadedCaseFile && uploadedTestCases) {
    setPreviewCases(YAML.load(uploadedTestCases) as any[]);
    if (stage < 2) setStage(2);
    return;                /* skip network call that yields 404 */
  }
  /* Built-in examples are still fetched from the server. */
  const { data: yaml } = await axios.get(
    `${API_BASE}/get-test-case-yaml?test_case=${encodeURIComponent(filename)}`
  );
  const cases = YAML.load(yaml) as any[];
  setPreviewCases(cases);
  if (stage < 2) setStage(2);
}
// Helper to pick the correct datasource name at runtime 
function buildDatasourceURL(
  tcFile: string
) {
  /* Always let the backend resolve the datasource from the test-case name. */
  return `${API_BASE}/get-datasource?test_case=${encodeURIComponent(tcFile)}`;
 }


  
      /** Stop the running evaluation */
      const handleStop = () => {
        cancelStream();
        // Immediately update local state to reflect stop
        setLoading(false);
        setEvaluating(false);
        setTotalChunks(receivedChunks);
        // Show user feedback
        message.info('Evaluation stopped');
      };




// Function to handle changes in selected test cases
 const handleTestCaseChange = async (selected: string[]) => {
  const trimmed = selected.map(s => s.trim());
  setSelectedTestCases(trimmed);

  if (!trimmed.length) {
    // clear preview if nothing selected
    setDatasource([]); setDatasourceColumnDefs([]);
    setDatasourceDescription(''); setDatasourceFields([]); setDataValues([]);
    return;
  }
  try {
    const url = buildDatasourceURL(trimmed[0]);
    const { data } = await axios.get(url);
    populateDatasourcePreview(data);            
  } catch (err) {
    console.error('Error fetching datasource', err);
    Modal.error({ title: 'Failed to fetch datasource', content: String(err) });

    // clear preview on failure
    setDatasource([]); setDatasourceColumnDefs([]);
    setDatasourceDescription(''); setDatasourceFields([]); setDataValues([]);
  }

  try {
    await fetchAndPreviewCases(selected[0]);
  } catch (err) {
    console.error('Error fetching test-case YAML', err);
    Modal.error({ title: 'Failed to fetch test cases', content: String(err) });
  }
};


// Function to download user logs
// const downloadUserLogs = async () => {
//   // removed per request
// };

// Removed download-logs helpers and CSV/XLSX generation

// Function to generate unique user ID based on browser/IP
const generateUniqueUserId = () => {
  try {
    // Try to get IP from a public service (for demo purposes)
    // In production, you might want to get this from your backend
    const userAgent = navigator.userAgent;
    const screenInfo = `${window.screen.width}x${window.screen.height}`;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const language = navigator.language;
    
    // Create a hash-like string from browser info
    const browserFingerprint = `${userAgent}|${screenInfo}|${timeZone}|${language}`;
    const hash = btoa(browserFingerprint).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    
    return `user_${hash}_${Date.now().toString(36)}`;
  } catch (error) {
    // Fallback to timestamp-based ID
    return `user_${Date.now().toString(36)}`;
  }
};

// Removed local log storage and global exposure for download logs

    // Function to handle test case evaluation
    const handleEvaluate = async () => {
      // Block any further actions if upload of datasources or test cases is still in flight
      // Esnure no upload is in progress
      if (uploading) return;
      // Require a test-case selection (now that users can upload)
      if (!selectedTestCases.length) {
          Modal.error({ title:'Select or upload test cases first' });
          return;
        }

      if (prompts.some((p) => p.text.trim() === "")) {
        Modal.error({
          title: "Prompt required",
          content: "Please fill every prompt (empty boxes are not allowed)."
        });
        return;                   
      }
      /* Build & validate the explicit test-ID list ------------------- */
      const testIds = parseTestRanges(testRange);

      /* Guard: user typed nonsense */
      if (testRange.trim() && testIds.length === 0) {
        Modal.error({ title: 'Invalid range',
                      content: 'Please enter numbers and ranges like "1-4, 7, 10-12".' });
        return;
      }

      /* Guard: validate test case numbers exist in selected file */
      if (testIds.length > 0 && previewRows.length > 0) {
        const availableTestNumbers = new Set(previewRows.map(row => row.test_number).filter((num): num is number => num !== undefined));
        const invalidTestNumbers = testIds.filter(id => !availableTestNumbers.has(id));
        
        if (invalidTestNumbers.length > 0) {
          const availableNumbers = Array.from(availableTestNumbers).sort((a, b) => a - b);
          const maxAvailable = Math.max(...availableNumbers);
          const minAvailable = Math.min(...availableNumbers);
          
          Modal.error({ 
            title: 'Invalid test case numbers',
            content: `The following test case numbers do not exist in the selected file: ${invalidTestNumbers.join(', ')}. ` +
                     `Available test case numbers range from ${minAvailable} to ${maxAvailable}. ` +
                     `Please enter valid test case numbers.`
          });
          return;
        }
      }

      /* Guard: NL metrics (except Info-Equivalence) need a judge model */
      const nlSelectedWithoutJudge = NL_METRICS.some(
        k => k !== 'information_similarity' && metricChecks[k]
      );
      if (!judgeModel && nlSelectedWithoutJudge) {
        Modal.error({
          title   : 'Judge model required',
         content : 'Natural-language metrics (other than Information Similarity) ' +
                    'require a judge model. Please pick one in the Settings drawer.',
        });
        return;
      }
      if (!selectedTestCases.length || !selectedModels.length || !runsPerInstance) {
       Modal.error({title: "Selections required", content: "Please select at least one test-case file and one model before running an evaluation."});
        return;
      }

      // Validate user ID is provided
      if (!userId.trim()) {
        Modal.error({title: "User ID Required", content: "Please enter your User ID before starting evaluation."});
        return;
      }


  /** Explicit IDs chosen by the user (empty ⇒ "all") */
  const chosenIds = new Set(parseTestRanges(testRange));


  /** Build the skeleton rows ---------------------------------- */
  const seen   = new Set<number | string>();   // test_number values we keep
  const rows: EvaluationDataRecord[] = [];

  for (const row of previewRows) {
    const file        = row.file || selectedTestCases[0];
    const rowId       = `${file}|${row.test_number}|${row.idx ?? 0}`;
    // Have we already seen N different test-cases?
    const caseId: string | number = row.test_number ?? row.key; 

    // Skip rows outside the chosen set (when a set was provided)
    if (chosenIds.size && !chosenIds.has(caseId as number)) continue;

    if (!seen.has(caseId)) seen.add(caseId);

    /* inside the limit → evaluating skeleton row */
    rows.push({
      ...row,
      file : file,    
      run_results    : {},  
      metric_averages: {}, 
      row_id: rowId, 
      model_outputs: Object.fromEntries(
        modelPromptKeys.map(k => [k, '__pending__'])
      ),
      modelVegaSpecs:        {},   // reset eval-time fields
      modelConversionErrors: {},
      metrics:               {},
      pass_fail:             {},
    });
  }

  setStage(3);
  setEvaluationData(rows);   // only rows from the limited test-cases
  /* ----- initialise progress ----- */
  setTotalChunks(rows.length * runsPerInstance);
  setReceivedChunks(0);
  setLoading(true);
  setEvaluating(true);
  // ----- build payload and hand off to the hook (job + events) -----
  const payload = {
      user_id: userId,
      test_cases: selectedTestCases,
      models: selectedModels,
      test_ids:  testIds,
      judgeModel,
      system_prompts: prompts.map(p => p.text),
      api_keys: userApiKeys,
      metrics: enabledMetrics,
      runs_per_instance: runsPerInstance,
    };

    // Removed local logging for download logs

    startStream(payload);
  };

  // Compute Differences Per Record and Model
  const differences = useMemo(() => {
        const diffMap: Record<
          string,
          Record<
            string,
            {
              missingProperties: string[];
              unequalProperties: string[];
              total: number;
            }
          >
        > = {};
    
      evaluationData.forEach((record) => {
        modelPromptKeys.forEach((model) => {
          const modelOutput = record.model_outputs?.[model] ?? '__pending__';
          if (modelOutput && modelOutput !== "__pending__") {
            let actualObj: any;
            try {
              const parsed = safeJsonParse<any>(modelOutput);
    
              // If the model's JSON has a 'content' field (like SFR-Tableau-Finetuned or your newly updated models),
              // we only want to compare that to the expected output.
              // Otherwise, we assume the top-level parsed object *is* the notional spec.
              actualObj = parsed.content ?? parsed;
            } catch (error) {
              console.error(`Error parsing model output for model ${model}:`, error);
              actualObj = {};
            }
    
            const { missingProperties, unequalProperties } = getDifferences(
              record.expected_output,
              actualObj
            );
    
            if (!diffMap[record.key]) {
              diffMap[record.key] = {};
            }
    
            diffMap[record.key][model] = {
              missingProperties,
              unequalProperties,
              total: missingProperties.length + unequalProperties.length,
            };
          }
        });
      });
    
      return diffMap;
    }, [evaluationData, modelPromptKeys]);



  // // Define FAQ panels
  // const faqItems: FAQPanel[] = [
  //           {
  //           key: '1',
  //           label: <span> <strong>How to use this tool?</strong></span>,
  //           content: (
  //               <ul>
  //               <li><strong>Test Cases:</strong> Select the test cases you want to evaluate.</li>
  //               <li><strong>Models:</strong> Choose which models you want to use for generating responses.</li>
  //               <li><strong>Test Limit:</strong> Specify how many test cases should be evaluated.</li>
  //               <li>After setting your preferences, click <strong>Evaluate</strong> to start the evaluation.</li>
  //               </ul>
  //           )
  //           },
  //           {
  //           key: '2',
  //           label: <span><strong>How are the models prompted?</strong></span>,
  //           content: (
  //               <pre style={{
  //               backgroundColor: '#f5f5f5',
  //               padding: '10px',
  //               borderRadius: '4px',
  //               fontFamily: 'monospace',
  //               fontSize: '14px',
  //               lineHeight: '1.5',
  //               whiteSpace: 'pre-wrap',
  //               wordBreak: 'break-word'
  //               }}>
  //               <p>Prompt Template:</p>
  //               {defaultSystemPrompt.trim()}
  //               </pre>
  //           )
  //           },
  //           {
  //           key: '3',
  //           label: <span><strong>What is the Notional Spec Schema?</strong></span>,
  //           content: (
  //               <div>
  //               <p><strong>Description:</strong> {schema.description}</p>
  //               <p><strong>Version:</strong> {schema.version}</p>
  //               <p><strong>Type:</strong> {schema.type}</p>

  //               <Collapse bordered={false} style={{ marginBottom: '16px', marginTop: '16px' }}>
  //                   <Collapse.Panel header="Properties" key="props">
  //                   {Object.keys(schema.properties).map(propKey => (
  //                       <Collapse key={propKey} style={{ marginBottom: '8px' }}>
  //                       <Collapse.Panel header={propKey} key={propKey}>
  //                           <JsonDisplay data={(schema.properties as any)[propKey]} />
  //                       </Collapse.Panel>
  //                       </Collapse>
  //                   ))}
  //                   </Collapse.Panel>
  //               </Collapse>

  //               <Collapse bordered={false}>
  //                   <Collapse.Panel header="Definitions" key="defs">
  //                   {Object.keys(schema.definitions).map(defKey => (
  //                       <Collapse key={defKey} style={{ marginBottom: '8px' }}>
  //                       <Collapse.Panel header={defKey} key={defKey}>
  //                           <JsonDisplay data={(schema.definitions as any)[defKey]} />
  //                       </Collapse.Panel>
  //                       </Collapse>
  //                   ))}
  //                   </Collapse.Panel>
  //               </Collapse>
  //               </div>
  //           )
  //           }
  //       ];

        // const faqItemsForCollapse: CollapseProps['items'] = faqItems.map(item => ({
        //     key: item.key,
        //     label: item.label,
        //     children: item.content,
        //     className: "custom-panel"
        //   }));          

   const { columns, allColumns } = useMemo(() => {
      
      const base: ColumnsType<EvaluationDataRecord> = [
        {
          title: "#",
          dataIndex: "test_number",
          key: "test_number",
          width: 50,
          sorter: (a, b) => (a.test_number || 0) - (b.test_number || 0),
          render: (n, record) => {
            // Show expand/collapse icon if this record has children
            const hasChildren = record.children && record.children.length > 0;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {hasChildren && (
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleRowExpand(record)}
                  ></span>
                )}
                <span>{n ?? ""}</span>
              </div>
            );
          },
        },
        {
          title: "Labels",
          dataIndex: "labels",
          key: "labels",
          width: 80,
          filters: allLabels.map(l => ({ text: l, value: l })),
          onFilter: (v, r) => typeof v === "string" && r.labels.includes(v),
          render: (lbls = [], rec) => (
            <LabelsCell labels={lbls} rowCount={(rec.children?.length ?? 0) + 1} />
          ),
        },
        {
          title: "User Utterance",
          dataIndex: "input",
          key: "input",
          width: 200,
          render: (txt, rec) => (
            <UserUtteranceCell
              fallbackText={txt}
              canonical={rec.canonical}
              paraphrases={rec.paraphrases}
            />
          ),
        },
        {
          title: "Expected Response",
          dataIndex: "expectedVegaSpec",
          key: "expected",
          width: 220,
          render: (__, rec) => {
            // ----- find the immediately‑preceding utterance in the same conversation -----
            const idx      = flatRows.findIndex(r => r.key === rec.key);
            const prevRow  = idx > 0 ? flatRows[idx - 1] : undefined;
            

            // Only treat it as "context" when it belongs to the same test_number
            const sameThread = prevRow && prevRow.test_number === rec.test_number;

            let prevContext: string | undefined;
            if (sameThread && prevRow?.expectedVegaSpec) {
              // Re‑describe the *previous* expected spec so we have a natural‑language thread
              prevContext = describeVegaSpec(prevRow.expectedVegaSpec, dataValues);
            }

            return (
              <ExpectedResponseCell
                vegaSpec={rec.expectedVegaSpec ?? null}
                errors={rec.expectedErrors ?? []}
                dataValues={dataValues}
                prevContext={prevContext}
              />
            );
          },
        },
      ];

      // 3) Add the model columns for each selected model
      const vizCols: ColumnsType<EvaluationDataRecord> = modelPromptKeys.map(k => {       
        const pretty = prettyModelPromptName(k);
        return {
          title: <span className="metricModelHeader">{pretty}</span>,
          key:   `viz_${k}`,
          width: 'auto',
          render: (_unused, rec) => (
            <ModelResponseCell
              record={rec}
              modelKey={k}
              modelLabel={pretty}
              vegaSpec={rec.modelVegaSpecs?.[k] ?? null}
              errors={rec.modelConversionErrors?.[k] || []}
              dataValues={dataValues}
              rawModelOutput={rec.model_outputs[k]}
              runResults={rec.run_results}
              totalRuns={Object.keys(rec.run_results ?? {}).length || 1}
              runIndex={getCurrentRunIndex(rec) ?? rec.representative_run_idx ?? 0}
              isSynchronized={showSpecificRun}
              onRunNavigation={handleRunNavigation}
              onToggleRunView={handleToggleRunView}
              currentRunIndex={selectedRunIndex}
            />
          )
        };
      });

      // 4) Add the metrics columns
      const metricCols: ColumnsType<EvaluationDataRecord> = [];

      const specEnabled = ['precision', 'recall', 'f1'].some(k => metricChecks[k]);
  metricCols.push({
    title: "Visualization Response Metrics",
    key:   "viz_overall",
    width: 'auto',
    render: (_: any, record) => (
              <VisualizationOverallMetrics 
          record={record} 
          models={modelPromptKeys} 
          enabled={enabledMetrics} 
          runIndex={getCurrentRunIndex(record)}
          isSynchronized={showSpecificRun}
          onRunNavigation={handleRunNavigation}
          onToggleRunView={handleToggleRunView}
          currentRunIndex={selectedRunIndex}
          totalRuns={Object.keys(record.run_results ?? {}).length || 1}
          showDiffButton={true}
          differences={differences[record.key] ?? {}}
        />
    )
  });
  /* show NL column when a judge is present **or** the standalone
     Information-Equivalence metric is selected                     */
  const showNLColumn = judgeModel || metricChecks['information_similarity'];
  if (showNLColumn) {
    metricCols.push({
      title: "Natural Language (NL) Response Metrics",
      key:   "nl_overall",
      width: 'auto',
      render: (_: any, record) => (
        <NaturalLanguageOverallMetrics
          record={record}
          models={modelPromptKeys}
          judgeModel={judgeModel || ''}          // empty string = "no judge"
          enabled={enabledMetrics}
          runIndex={getCurrentRunIndex(record)}
          isSynchronized={showSpecificRun}
          onRunNavigation={handleRunNavigation}
          onToggleRunView={handleToggleRunView}
          currentRunIndex={selectedRunIndex}
          totalRuns={Object.keys(record.run_results ?? {}).length || 1}
          isLoadingJudgeEvaluations={modelPromptKeys.some(modelKey => 
            isJudgeEvaluationLoading(record.row_id || '', modelKey)
          )}
        />
      )
    });
  }
  // only if ≥1 of P/R/F1 is selected
  if (specEnabled) {
    metricCols.push({
      title: "Traditional NLG Accuracy Metrics",
      key:   "accuracy_subcat",
      width: 'auto',
      render: (_: any, record) => (
        <AccuracyMetrics
          record={record}
          models={modelPromptKeys}
          enabled={prfEnabled}
          runIndex={getCurrentRunIndex(record)}
          isSynchronized={showSpecificRun}
          onRunNavigation={handleRunNavigation}
          onToggleRunView={handleToggleRunView}
          currentRunIndex={selectedRunIndex}
          totalRuns={Object.keys(record.run_results ?? {}).length || 1}
            refreshToken={receivedChunks}
        />
      )
    });
      }

      // Compose final column list
      const allCols = stage >= 3 ? [...base, ...vizCols, ...metricCols] : base;

      /* ───────── Apply user hide / freeze choices ───────── */
      const visibleCols = allCols
        .filter(col => !hiddenColumns.has(col.key as string))
        .map(col =>
          frozenColumns.has(col.key as string)
            ? { ...col, fixed: 'left' as const }
            : { ...col, fixed: undefined }
        );

      return { columns: visibleCols, allColumns: allCols };
    }, [
      selectedModels,
      hiddenColumns,
      frozenColumns,
      judgeModel,
      allLabels,
      dataValues,
      differences,

      flatRows, 
      metricChecks,
      enabledMetrics,
      showSpecificRun,
      selectedRunIndex, 
      prfEnabled,
      expandedRows       // <-- add this
    ]);

    return (
        <div>
            <h2 style={{alignContent: 'center'}}> Which Model Speaks <i> Your </i> Data Language?</h2>
            <h3> Lexara: Evaluating Language Models for Analytical Conversation </h3>
            <div style={{ position: 'absolute', top: 72, right: 16, display: 'flex', gap: '8px' }}>
        <Button
          type="primary"
          icon={<SettingOutlined />}
          onClick={() => setDrawerVisible(true)}
        />
      </div>
        <Drawer
            title="Set Up Your Evaluation!"
            placement="right"
            width="30%"
            onClose={() => setDrawerVisible(false)}
            open={drawerVisible}
        >
            <Divider>User Identification</Divider>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Input
                  placeholder="Enter your User ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  style={{ flex: 1 }}
                  status={userId.trim() === '' ? 'error' : ''}
                />
                <Tooltip title="Create an auto-generated user ID">
                  <Button
                    onClick={() => setUserId(generateUniqueUserId())}
                  >
                    Auto
                  </Button>
                </Tooltip>
                {/* Download logs button removed */}
              </div>
              {userId.trim() === '' && (
                <Alert
                  type="warning"
                  showIcon
                  message="User ID is required to start evaluation"
                  style={{ marginBottom: 12 }}
                />
              )}
            </Space>
           <ApiKeySection keys={userApiKeys} setKeys={setUserApiKeys} status={keyStatus} srcMap={keySource} />
            <Divider>Upload Test Cases</Divider>
            {uploading && (
            <Progress
              percent={uploadPercent}
              size="small"
              status={uploadPercent === 100 ? 'success' : 'active'}
              style={{ marginBottom: 16 }}
            />)} 
            
            <Alert
              type="info"
              showIcon
              message={
              <>
                Data Source YAML must include the mandatory properties&nbsp;
                <Typography.Text code>title</Typography.Text>,&nbsp;
                <Typography.Text code>datasourceFields</Typography.Text> with&nbsp;
                <Typography.Text code>name</Typography.Text> and&nbsp;
                <Typography.Text code>fieldValues</Typography.Text>.
                <a onClick={() => setShowDsExample(true)} style={{ marginLeft: 8 }}>
                  Example
                </a>
              </>   
            }
            style={{ marginBottom: 12 }}
             />

          <Modal
            title="Datasource YAML example"
            open={showDsExample}
            footer={null}
            onCancel={() => setShowDsExample(false)}
          >
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {DS_SNIPPET}
            </pre>
          </Modal>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>

              <Upload.Dragger
                accept=".yaml,.yml"
                maxCount={1}
                beforeUpload={file => false}        // manual
                onChange={info => {
                  // `originFileObj` when available, otherwise the UploadFile itself
                  const fileObj = (info.file.originFileObj ?? info.file) as File;

                  // Skip if we still don't have a File (e.g. progress / remove events)
                  if (!fileObj.text) return;
                  fileObj.text().then(handleDatasourceAccepted);
                }}
              >
                <p>Upload datasource YAML</p>
              </Upload.Dragger>
              <Alert
              type="info"
              showIcon
              message={
              <>
                Test Case YAML must include&nbsp;
                <Typography.Text code>test-number</Typography.Text>,&nbsp;
                <Typography.Text code>utterances</Typography.Text>,&nbsp;
                <Typography.Text code>notional-spec-out</Typography.Text>.&nbsp;
              <a onClick={() => setShowTcExample(true)} style={{ marginLeft: 8 }}>
                  Example
              </a>
              </>
          }
              style={{ marginBottom: 12 }}
            />
            <Modal
            title="Test Case YAML example"
            open={showTcExample}
            footer={null}
            onCancel={() => setShowTcExample(false)}
          >
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {TC_SNIPPET}
            </pre>
          </Modal>
              <Upload.Dragger
                accept=".yaml,.yml"
                maxCount={1}
                beforeUpload={file => false}
                onChange={info => {
                  // `originFileObj` when available, otherwise the UploadFile itself
                  const fileObj = (info.file.originFileObj ?? info.file) as File;

                  // Skip if we still don't have a File (e.g. progress / remove events)
                  if (!fileObj.text) return;

                  fileObj.text().then(handleTestcaseAccepted);
                }}
              >
                <p>Upload test-cases YAML</p>
              </Upload.Dragger>

            </Space>

            <Divider>Select Test Cases</Divider>

            <Select
              style={{ width: "100%" }}
              placeholder="Select a test set"
              value={selectedTestCases[0]}
              onChange={(val) => handleTestCaseChange([val])}
              optionLabelProp="shortLabel"
              showSearch
              options={availableTestCases.map(tc => {
                const isUploaded = tc === uploadedCaseFile;
                const mapping    = testCaseMapping[tc];
                return {
                  value: tc,
                  shortLabel: mapping ? mapping.title : tc,
                  label: (
                    <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                      <span style={{ flex:1, minWidth:50 }}>{mapping?.title ?? tc}</span>
                      {mapping && (
                        <Tag color={getDifficultyTagColor(mapping.difficulty)}>
                          {mapping.difficulty}
                        </Tag>
                      )}
                      {isUploaded && <Tag color="purple">uploaded</Tag>}
                      {mapping && (
                        <Tag color={getDomainTagColor(mapping.domain)} icon={getDomainIcon(mapping.domain)}>
                          {mapping.domain}
                        </Tag>
                      )}
                    </div>
                  )
                };
              })}
            />

              <Divider> Specify System Prompts</Divider>
              <PromptList prompts={prompts} setPrompts={setPrompts} />
              {prompts.every((p) => p.text.trim() !== "") ? null : (
                <Alert type="error" message="Every prompt is required" />
              )}

               <Divider>Select Models</Divider>
                <Select
                mode="multiple"
                style={{ width: "100%" }}
                placeholder="Select models"
                value={selectedModels}
                onChange={setSelectedModels}
                options={models.map(m => ({
                 ...m,
                /* grey‑out the current judge so users can't pick it here */
                disabled: m.value === judgeModel,
                }))}
            />

 
              <Divider>Select Metrics</Divider>
              <Collapse size="small" defaultActiveKey={['viz','nl', 'spec']}>
            {(['viz','nl', 'spec'] as const).map(catKey => {
              // get the category from the metric tree
              const cat   = METRIC_TREE[catKey];
              // get the metrics for this category
              const cKeys = Object.values(cat.children).flat() as string[];

              /* parent-level "indeterminate" logic */
              const allOn  = cKeys.every(k => Boolean(metricChecks[k]));
              const noneOn = cKeys.every(k => !metricChecks[k]);

              const toggleParent = (checked:boolean) => {
                setMetricChecks(prev => {
                  const next = { ...prev };
                  cKeys.forEach(k => {
                    /* guard: when cat == spec and key== 'f1' dependency applies */
                    if (k === 'f1' && (!checked || !prev.precision || !prev.recall)) {
                      next[k] = false;
                    } else {
                      next[k] = checked;
                    }
                  });
                  return next;
                });
              };

                              return (
                  <Collapse.Panel header={cat.title} key={catKey}>
                    {/* parent checkbox */}
                  <Checkbox
                    checked={allOn}
                    indeterminate={!allOn && !noneOn}
                    onChange={e => toggleParent(e.target.checked)}
                    style={{ marginBottom: 8, fontWeight:'bold' }}
                  >
                    {cat.title}
                  </Checkbox>
                {/* children grouped by buckets (2nd tier) */}
                {Object.entries(cat.children).map(([bucket, keys]) => {
                  const bKeys    = keys as string[];
                  /* ───── bucket label in Title‑Case with spaces ───── */
                  const bucketLabel =
                    bucket === 'f1'
                      ? 'F1'                                   // special‑case
                      : bucket
                          .replace(/([a-z])([A-Z])/g, '$1 $2')  // camel → spaced
                          .replace(/^./, c => c.toUpperCase());
                  
                  const bucketTip: string | undefined = (() => {
                  if (bucket in vizBucketDefinitions)
                    return vizBucketDefinitions[bucket as keyof typeof vizBucketDefinitions];

                  if (bucket in nlBucketDefinitions)
                    return nlBucketDefinitions[bucket as keyof typeof nlBucketDefinitions];

                  if (bucket === 'f1')
                    return 'Harmonic mean of Precision and Recall.';

                  return undefined;
                })();
                /* parent‑checkbox state */
                const bAllOn   = bKeys.every(k => Boolean(metricChecks[k]));
                const bNoneOn  = bKeys.every(k => !metricChecks[k]);

                const toggleBucket = (checked: boolean) => {
                  setMetricChecks(prev => {
                    const next = { ...prev };
                    bKeys.forEach(k => {
                      /* F1 dependency: disabled unless precision && recall */
                      if (k === 'f1' && (!checked || !prev.precision || !prev.recall)) {
                        next[k] = false;
                      } else {
                        next[k] = checked;
                      }
                    });
                    return next;
                  });
                };

            return (
              <div key={bucket} style={{ marginLeft: 24, marginBottom: 4 }}>
                {/* bucket-level checkbox */}
                <Checkbox
                  checked={bAllOn}
                  indeterminate={!bAllOn && !bNoneOn}
                  onChange={e => toggleBucket(e.target.checked)}
                  style={{ fontWeight: 'bold', marginBottom: 4 }}
                >
                  {bucketLabel}
                </Checkbox>
                <br />

                {/* metric leaf checkboxes */}
                {bKeys
                  .filter(k => !(bucket === 'f1' && k === 'f1'))
                  .map(k => {
                    const meta   = metricsMap.get(k) ?? judgeInfoMap.get(k as any);
                    const label  = meta?.label ?? k
                                      .replace(/([a-z])([A-Z])/g,'$1 $2')
                                      .replace(/^./, c => c.toUpperCase());
                    
                   const isNLM      = NL_METRICS.includes(k as any);
                    const isDisabled = (k === 'f1' && (!metricChecks['precision'] || !metricChecks['recall'])) || (isNLM && !judgeModel && k !== 'information_similarity');
                    return (
                                            <Checkbox
                                              key={k}
                                              checked={metricChecks[k]}
                                              disabled={isDisabled}
                                              onChange={e => toggleMetric(k, e.target.checked)}
                                              style={{ marginRight: 12, marginLeft: 24 }}
                                            >
                                              {labelWithInfo(String(label), k)}
                                            </Checkbox>
                                          );
                  })}
              </div>
            );
          })}
          
          {/* Judge Model Selection for NL metrics - positioned after Factual Grounding */}
          {catKey === 'nl' && (
            <>
              {/* Friendly notice when NL metrics need a judge */}
              {!judgeModel && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 16, marginBottom: 12 }}
                  message="Select a judge model to enable the remaining natural-language metrics."
                />
              )}
              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 'bold' }}>
                Select Judge Model
              </div>
              <Select
                style={{ width: '100%', marginBottom: 16 }}
                placeholder="Select a Judge Model"
                value={judgeModel ?? undefined}
                onChange={v => setJudgeModel(v ?? null)}
                allowClear
                options={models.map(m => ({
                  ...m,
                  /* grey‑out any model that is already in the generation list */
                  disabled: selectedModels.includes(m.value),
                  label:
                    m.value === recommendedJudge
                      ? `${m.label} (recommended)`
                      : m.label,
                }))}
              />
            </>
          )}

                  
          </Collapse.Panel>
              );
            })}
          </Collapse>

           
            
           
            <Divider>Specify Which Test Cases To Run</Divider>
            {(() => {
              const availableTestNumbers = previewRows.length > 0 
                ? Array.from(new Set(previewRows.map(row => row.test_number).filter((num): num is number => num !== undefined))).sort((a, b) => a - b)
                : [];
              const placeholder = availableTestNumbers.length > 0
                ? `e.g. 1-5, 8, 11-13  (available: ${Math.min(...availableTestNumbers)}-${Math.max(...availableTestNumbers)}, blank = all)`
                : "e.g. 1-5, 8, 11-13  (blank = all)";
              
              return (
                <div>
                  <Input
                    placeholder={placeholder}
                    value={testRange}
                    onChange={e => setTestRange(e.target.value)}
                  />
                  {availableTestNumbers.length > 0 && (
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                      Available test cases: {availableTestNumbers.join(', ')}
                    </div>
                  )}
                </div>
              );
            })()}
            
           <Divider>Number of Runs Per Utterance</Divider>
          <Select
            style={{ width:'100%' }}
            value={runsPerInstance}
            onChange={v => setRunsPerInstance(v)}
            options={[1,2,3,4,5].map(n => ({ value:n, label:String(n) }))}
          />
          <Divider />
            <Space>
            <Button type="primary" onClick={handleEvaluate} loading={loading} disabled={!selectedTestCases.length || !selectedModels.length || prompts.some(p => !p.text.trim()) || !runsPerInstance || loading || evaluating || !userId.trim()} style={{ background: '#1170AA', borderColor: '#1170AA', color: '#fff' }}>
                Evaluate
            </Button>   
            
              {evaluating && (
                  <Tooltip title="Stop evaluation">
                    <Button
                      icon={<StopOutlined />}
                      onClick={handleStop}
                      style={{ background: '#E54D37', borderColor: '#E54D37', color: '#fff' }}
                    />
                  </Tooltip>
              )}

                </Space>



            </Drawer>

        

      {/* Metrics Drawer */}
      <Drawer
        title="Metrics by Label"
        placement="right"
        onClose={() => setMetricsDrawerVisible(false)}
        open={metricsDrawerVisible}
        width="auto" 
      >
        <MetricsByLabelPanel
          evaluationData={evaluationData}
          selectedModels={modelPromptKeys}
          judgeModel={judgeModel}
        />
      </Drawer>
      {stage >= 1 && (
        <Collapse
          activeKey={isDatasourceExpanded ? [DATASOURCE_PANEL_KEY] : []}
          onChange={(keys) =>
            setIsDatasourceExpanded(keys.includes(DATASOURCE_PANEL_KEY))
          }
        >
          <Panel
            key={DATASOURCE_PANEL_KEY}
            header={
              <div className="panelHeader">
                {selectedTestCaseMapping ? (
                  <div className="panelHeader__titleGroup">
                    <span>{selectedTestCaseMapping.title}</span> <span></span>
                    <Tag color={getDifficultyTagColor(selectedTestCaseMapping.difficulty)}>
                      {selectedTestCaseMapping.difficulty}
                    </Tag>
                    <Tag
                      color={getDomainTagColor(selectedTestCaseMapping.domain)}
                      icon={getDomainIcon(selectedTestCaseMapping.domain)}
                    >
                      {selectedTestCaseMapping.domain}
                    </Tag>
                  </div>
                ) : (
                  <span>Datasource Table</span>
                )}

                {datasourceDescription && (
                  <Tooltip title={datasourceDescription}>
                    <InfoCircleOutlined style={{ marginLeft: 8 }} />
                  </Tooltip>
                )}
              </div>
            }
          >
            {(() => {
              const visibleRows = isDatasourceExpanded
                ? datasource
                : datasource.slice(0, 3);

              const scrollY = isDatasourceExpanded ? 500 : 150;

              return (
                <div
                  className={
                    isDatasourceExpanded
                      ? 'table-wrapper table-wrapper--big'
                      : 'table-wrapper'
                  }
                >
                  <Table
                    dataSource={visibleRows}
                    columns={datasourceColumnDefs}
                    pagination={false}
                    scroll={{ y: scrollY }}
                  />
                </div>
              );
            })()}
          </Panel>
      </Collapse>)}
    
  {stage >= 3 && (
  <> 
  <Divider>Overview Results</Divider>
  {metricsReady && evaluationData.length > 0 && (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <Tooltip title="Examine  Metric Breakdown By Labels">
        <Button
          type="default"
          icon={<SlidersOutlined />}
          onClick={() => setMetricsDrawerVisible(true)}
        >
          Metric Breakdown By Labels
        </Button>
      </Tooltip>
    </div>
  )}
  {/* Progress bar while rows stream in */}
  {streamState.status === 'running' ? (
    <>
      <Progress
         percent={Number(Math.min(progressPct, 100).toFixed(2))}
         status="active"
         style={{ marginBottom: 16, width: '100%' }}
         format={(percent) => {
           if (streamState.granular) {
             const fragmentPercentage = totalChunks > 0 ? (streamState.fragments.length / totalChunks) * 100 : 0;
             return `${streamState.fragments.length}/${totalChunks} (${fragmentPercentage.toFixed(1)}%)`;
           }
           return `${receivedChunks}/${totalChunks} (${percent?.toFixed(1)}%)`;
         }}
         />
      


    </>
  ) : (
  <MetricsLayout scrollCards={false}>
      <FlexCard title="Recommended Model & Prompt" 
      loading={loading || topModel === null}>
        {evaluationData.length > 0 && topModel && (
          <Statistic
            value={prettyModelPromptName(topModel)}
            valueStyle={{ fontSize: 28, fontWeight: 700 }}
          />
        )}
      </FlexCard>
      {/* Visualization metrics */}
    <FlexCard
      title="Avg. Visualization Metrics"
      loading={!metricsReady || evaluationData.length === 0}
    >
      {/* Show skeleton until we're truly ready */}
      {(!metricsReady || evaluationData.length === 0) ? (
        <Skeleton active title={{ width: 120 }} paragraph={false} />
      ) : (
        <VisualizationOverallMetrics
          record={vizAvgRecord}
          models={modelPromptKeys}
          enabled={enabledMetrics}
          showDiffButton={false}
          showTooltips={false}
          isSynchronized={false}
          onRunNavigation={undefined}
          currentRunIndex={null}
          totalRuns={undefined}
        />
      )}
    </FlexCard>
      {/* Natural-language metrics (always shown) */}
      <FlexCard title="Avg. Natural-Language Metrics" loading={!metricsReady || evaluationData.length === 0}>
        
        {(!metricsReady || evaluationData.length === 0) ? (
      <Skeleton active title={{ width: 120 }} paragraph={false} />
    ) : (
          <NaturalLanguageOverallMetrics
            record={nlAvgRecord}
            models={modelPromptKeys}
            judgeModel={judgeModel || undefined}
            enabled={enabledMetrics}
            showTooltips={false}
            isSynchronized={false}
            onRunNavigation={undefined}
            currentRunIndex={null}
            totalRuns={undefined}
          />
        )}

      </FlexCard>

      {/* Spec accuracy (F1) */}
      <FlexCard title="Avg. Traditional NLG Accuracy Metrics" loading={!metricsReady || evaluationData.length === 0}>
        {evaluationData.length > 0 && (
          <AccuracyMetrics
            record={f1AvgRecord}
            models={modelPromptKeys}
            enabled={prfEnabled}
            showTooltips={false}
            isSynchronized={false}
            onRunNavigation={undefined}
            currentRunIndex={null}
            totalRuns={undefined}
          />
        )}
      </FlexCard>
    </MetricsLayout>
  )}
  </>
)}


{stage >= 2 && (
  <>      
        <Divider>Evaluate Test Cases</Divider>
        <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
            {/* ───── Column-chooser popover ───── */}
            <Popover
              trigger="click"
              placement="bottomLeft"
              overlayStyle={{ maxWidth: 280 }}
              content={
                <div style={{ maxHeight: 320, overflowY: 'auto', padding: '8px 0' }}>

                  <strong>Show / Hide</strong>
                  <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                    {allColumns.map(c => (
                      <Checkbox 
                        key={c.key} 
                        checked={!hiddenColumns.has(c.key as string)}
                        onChange={(e) => {
                          const newHiddenColumns = new Set(hiddenColumns);
                          if (e.target.checked) {
                            newHiddenColumns.delete(c.key as string);
                          } else {
                            newHiddenColumns.add(c.key as string);
                          }
                          setHiddenColumns(newHiddenColumns);
                        }}
                        style={{
                          opacity: hiddenColumns.has(c.key as string) ? 0.5 : 1,
                          color: hiddenColumns.has(c.key as string) ? '#999' : 'inherit',
                          textDecoration: hiddenColumns.has(c.key as string) ? 'line-through' : 'none'
                        }}
                      >
                        {colLabel(c)}
                        {frozenColumns.has(c.key as string) && (
                          <span style={{ marginLeft: 8, color: '#1890ff', fontSize: '12px' }}>
                            (frozen)
                          </span>
                        )}
                      </Checkbox>
                    ))}
                  </div>

                  <Divider style={{ margin: '8px 0' }} />
                  <strong>Freeze (fix)</strong>
                  <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                    {allColumns.map(c => (
                      <Checkbox 
                        key={c.key} 
                        checked={frozenColumns.has(c.key as string)}
                        disabled={hiddenColumns.has(c.key as string)}
                        onChange={(e) => {
                          const newFrozenColumns = new Set(frozenColumns);
                          if (e.target.checked) {
                            // When freezing a column, also freeze all columns to the left of it
                            const currentColumnIndex = allColumns.findIndex(col => col.key === c.key);
                            if (currentColumnIndex >= 0) {
                              // Add all columns from index 0 to currentColumnIndex (inclusive)
                              for (let i = 0; i <= currentColumnIndex; i++) {
                                const columnKey = allColumns[i].key as string;
                                if (!hiddenColumns.has(columnKey)) {
                                  newFrozenColumns.add(columnKey);
                                }
                              }
                            }
                          } else {
                            // When unfreezing a column, also unfreeze all columns to the right of it
                            const currentColumnIndex = allColumns.findIndex(col => col.key === c.key);
                            if (currentColumnIndex >= 0) {
                              // Remove all columns from currentColumnIndex onwards
                              for (let i = currentColumnIndex; i < allColumns.length; i++) {
                                const columnKey = allColumns[i].key as string;
                                newFrozenColumns.delete(columnKey);
                              }
                            }
                          }
                          setFrozenColumns(newFrozenColumns);
                        }}
                        style={{
                          color: frozenColumns.has(c.key as string) ? '#1890ff' : 'inherit',
                          fontWeight: frozenColumns.has(c.key as string) ? 'bold' : 'normal',
                          opacity: hiddenColumns.has(c.key as string) ? 0.5 : 1,
                          backgroundColor: frozenColumns.has(c.key as string) ? 'rgba(24, 144, 255, 0.05)' : 'transparent'
                        }}
                      >
                        {colLabel(c)}
                        {hiddenColumns.has(c.key as string) && (
                          <span style={{ marginLeft: 8, color: '#999', fontSize: '12px' }}>
                            (hidden)
                          </span>
                        )}
                        {frozenColumns.has(c.key as string) && !hiddenColumns.has(c.key as string) && (
                          <span style={{ marginLeft: 8, color: '#1890ff', fontSize: '12px' }}>
                            (frozen)
                          </span>
                        )}
                      </Checkbox>
                    ))}
                  </div>
                </div>
              }
            >
              <Button icon={<TableOutlined />}>
                Columns
              </Button>
            </Popover>

            {runsPerInstance > 1 && (
              <Switch
                  checkedChildren="Show Specific Run"
                  unCheckedChildren="Show Averaged"
                  checked={showSpecificRun}
                  onChange={(checked) => {
                    if (checked) {
                      // Switch to specific run view (start with representative run)
                      const representativeRun = evaluationData.length > 0 ? 
                        evaluationData[0].representative_run_idx ?? 0 : 0;
                      setShowSpecificRun(true);
                      setSelectedRunIndex(representativeRun);
                    } else {
                      // Switch back to averaged view
                      setShowSpecificRun(false);
                      setSelectedRunIndex(null);
                    }
                  }}
                  disabled={evaluationData.length === 0 || Object.keys(evaluationData[0]?.run_results ?? {}).length <= 1}
                  style={{ marginLeft: 16 }}
              />
            )}

            <Tooltip title="Download as CSV">
              <Button
                icon={<DownloadOutlined />}
                loading={csvDownloadLoading}
                onClick={() => {
                  try {
                    setCsvDownloadLoading(true);
                    downloadEvaluationResultsAsCSV(
                      evaluationData,
                      modelPromptKeys,
                      showSpecificRun,
                      selectedRunIndex,
                      dataValues
                    );
                  } catch (error) {
                    console.error('Error downloading CSV:', error);
                    message.error('Failed to download CSV file. Please try again.');
                  } finally {
                    setCsvDownloadLoading(false);
                  }
                }}
                disabled={evaluationData.length === 0}
                style={{ marginLeft: 16 }}
              >
                Download as CSV
              </Button>
            </Tooltip>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <strong> Metrics' Legend: </strong>
          <LegendItem
            color="#E54D37"
            background="rgba(229,77,55,0.1)"
            label=" Low"
          />
          <LegendItem
            color="#F2B134"
            background="rgba(242,177,52,0.1)"
            label="Medium"
          />
          <LegendItem
            color="#1170AA"
            background="rgba(17,112,170,0.1)"
            label="High Scores"
          />
        </div>
      </div>
      
      <div style={{ marginTop: 16 }}>
        <TableErrorBoundary>
        <Table<EvaluationDataRecord>
          className="metrics-table"
          dataSource={stage >= 3 ? groupedData : groupedPreviewData}
          columns={columns}
          style={{ tableLayout: 'fixed' }}
           loading={loading && !evaluating}
          rowKey={(record) => record.key}
          rowClassName={rowClassName}
          scroll={{
            x: true,
            y: 1000
          }}
          indentSize={0}  
          sticky
          pagination={false}
        />
        </TableErrorBoundary>
      </div>
        </> 
    )}
    </div>
    );
};

export default TestCaseEvaluation;
