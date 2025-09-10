import React from 'react';
import { diffWords } from 'diff';
import {
  CustomerServiceOutlined,
  ShoppingCartOutlined,
  BarChartOutlined,
  TeamOutlined,
  FileOutlined,
  DollarCircleOutlined,
  DesktopOutlined,
  UploadOutlined
} from '@ant-design/icons';

import './TestCaseEvaluation.css';
import { EvaluationDataRecord, NotionalSpec } from './types';
import { modelNameMap } from "./constants";

// Function to get color for labels
export const getColorForLabel = (label: string) => {
  const colors = [
    'magenta',
    'red',
    'volcano',
    'orange',
    'gold',
    'lime',
    'green',
    'cyan',
    'blue',
    'geekblue',
    'purple',
  ];
  const index = Math.abs(
    label.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  ) % colors.length;
  return colors[index];
};

// Function to get differences across notional spec jsons
export const getDifferences = (expected: any, actual: any) => {
  // missing properties : properties in the model output that have been added to what's in the expected output 
  const missingProperties: string[] = [];
  // unequal properties: properties that are in the expected output but not in the model output
  const unequalProperties: string[] = [];

  // expected output properties
  const expectedKeys = Object.keys(expected);
  // model output properties
  const actualKeys = Object.keys(actual);

  // Identify missing properties
  expectedKeys.forEach((key) => {
    if (!actualKeys.includes(key)) {
      missingProperties.push(key);
    } else if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key])) {
      unequalProperties.push(key);
    }
  });

  // Identify additional properties in actual that are not in expected
  actualKeys.forEach((key) => {
    if (!expectedKeys.includes(key)) {
      missingProperties.push(key); // Treat as missing from expected
    }
  });

  return { missingProperties, unequalProperties };
};

// Function to highlight the differences between the expected output and model outputs
export const highlightDiffs = (
  expected: any,
  actual: string,
  showMissing: boolean,
  showUnequal: boolean
): JSX.Element => {
  let actualObj: any;
  try {
    actualObj = JSON.parse(actual);
  } catch (error) {
    return <span style={{ color: 'red' }}>Invalid JSON</span>;
  }

  // Get differences across notional spec jsons
  const { missingProperties, unequalProperties } = getDifferences(expected, actualObj);

  const expectedString = JSON.stringify(expected, null, 2);
  const actualString = JSON.stringify(actualObj, null, 2);
  const diff = diffWords(expectedString, actualString);

  // Return the highlights as styling 
  return (
    <pre className="diff-container">
      {diff.map((part, index) => {
        let className = '';
        if (part.added && showUnequal) {
          className = 'diff-added'; // Highlight added (unequal) properties
        } else if (part.removed && showMissing) {
          className = 'diff-removed'; // Highlight removed (missing) properties
        }

        return (
          <span key={index} className={className}>
            {part.value}
          </span>
        );
      })}
    </pre>
  );
};

// Function to call out the the differences between the expected output and model outputs notional specs 
export const generateDifferenceDescriptions = (
  record: any,
  model: string,
  differences: Record<
    string,
    Record<string, { missingProperties: string[]; unequalProperties: string[]; total: number }>
  >
): JSX.Element => {
  const modelDiff = differences[record.key]?.[model];
  if (!modelDiff) return <span>No differences</span>;

  const { missingProperties, unequalProperties } = modelDiff;

  const descriptions: string[] = [];

  // Missing or Additional Properties
  missingProperties.forEach((prop) => {
    if (Object.keys(record.expected_output).includes(prop)) {
      descriptions.push(`Missing property "${prop}" from the Expected Raw Output.`);
    } else {
      descriptions.push(`Additional property "${prop}" found in the Model Raw Output.`);
    }
  });

  // Unequal Values
  unequalProperties.forEach((prop) => {
    descriptions.push(
      `Unequal value for property "${prop}" between Expected Raw Output and Model Raw Output.`
    );
  });

  if (descriptions.length === 0) {
    return <span>No differences</span>;
  }

  return (
    <ol>
      {descriptions.map((desc, index) => (
        <li key={index}>{desc}</li>
      ))}
    </ol>
  );
};

// Helper function to group test cases 
export function groupByTestNumber(data: EvaluationDataRecord[]): EvaluationDataRecord[] {
  // 1) Check if data is array and not empty
  if (!Array.isArray(data) || data.length === 0) {
    console.warn("No data provided to groupByTestNumber.");
    return [];
  }

  const map = new Map<number, EvaluationDataRecord>();

  data.forEach((item) => {
    // 2) Handle undefined or null test_number explicitly
    const testNum = item.test_number;
    if (testNum == null) {
      console.warn("Encountered record without a test_number:", item);
      // Decide what to do: skip, or group them by some default key
      // For now, we'll just skip them
      return;
    }

    // Add or update the parent in the map
    const existing = map.get(testNum);
    if (!existing) {
      map.set(testNum, { ...item, children: [] });
    } else {
      existing.children!.push(item);
    }
  });

  // Clean up if there are parents without children
  const result = Array.from(map.values()).map((parent) => {
    if (!parent.children?.length) {
      delete parent.children; // remove the empty children array
    }
    return parent;
  });

  return result;
}

// Helper function to choose a tag color based on test case difficulty
const difficultyColors: Record<string, string> = {
  easy: 'lime',
  medium: 'gold',
  hard: 'red',
  uploaded: "purple"
};

export const getDifficultyTagColor = (difficulty: string): string =>
  difficultyColors[difficulty.toLowerCase()] || 'default';

export function getDomainTagColor(domain: string): string {
  const domainColors: Record<string, string> = {
    sales: "lime",
    "customer support": "green",
    marketing: "volcano",
    it: "geekblue",
    hr: "magenta",
    uploaded: "purple", // for custom domains
  };

  return domainColors[domain.toLowerCase()] ?? "default";
}

export function getDomainIcon(domain: string): React.ReactNode {
  const domainIconMap: Record<string, React.ReactNode> = {
    sales: <DollarCircleOutlined />,
    'customer support': <CustomerServiceOutlined />,
    marketing: <BarChartOutlined />,
    hr: <TeamOutlined />,
    it: <DesktopOutlined />,
    uploaded: <UploadOutlined />, // for custom domains
  };
  return domainIconMap[domain.toLowerCase()] ?? <FileOutlined />;
}

export function isNotionalSpec(obj: unknown): obj is NotionalSpec {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Partial<NotionalSpec>;

  // Minimal checks: does `candidate.version` exist and is it a string?
  // Does `candidate.fields` exist and is it an array?
  if (typeof candidate.version !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.fields)) {
    return false;
  }
  return true;
}

/**
 * Attempts to parse a JSON string into a NotionalSpec.
 * - If `parsed.content` exists, use that.
 * - If the final object doesn't match the NotionalSpec shape, return null.
 */
export function safeParseModelOutput(output: string): NotionalSpec | null {
  try {
    // Parse JSON
    const parsed = JSON.parse(output);
    // If there's a "content" field, assume the real spec is in `parsed.content`
    const candidate = parsed.content ?? parsed;

    // Check if the candidate object matches NotionalSpec
    if (isNotionalSpec(candidate)) {
      return candidate;
    } else {
      console.error("Parsed object does not match NotionalSpec shape:", candidate);
      return null;
    }
  } catch (error) {
    console.error("Error parsing model output:", error);
    return null;
  }
}

type ScoreCategory = 'low' | 'medium' | 'high';

const getScoreCategory = (score: number): ScoreCategory => {
  if (score <= 2) return 'low';
  if (score <= 4) return 'medium';
  return 'high';
};

export const getScoreColor = (score: number): string => {
  const category = getScoreCategory(score);
  if (category === 'low') return 'red';
  if (category === 'medium') return 'orange';
  return 'green';
};

export const getAlertType = (score: number): 'error' | 'warning' | 'success' => {
  const category = getScoreCategory(score);
  if (category === 'low') return 'error';
  if (category === 'medium') return 'warning';
  return 'success';
};

export const getAlertColors = (score: number): { background: string; border: string } => {
  const category = getScoreCategory(score);
  switch (category) {
    case 'low':
      return { background: '#fff1f0', border: '#ff4d4f' };
    case 'medium':
      return { background: '#fffbe6', border: '#faad14' };
    case 'high':
      return { background: '#f6ffed', border: '#52c41a' };
  }
};

export function prettyModelPromptName(raw: string): string {
  // handles both "o1"  *and* "o1|prompt3"
  const [modelId, promptPart] = raw.split("|");        // "o1",  "prompt3?"
  const label = modelNameMap[modelId] ?? modelId;      // "o1"

  if (!promptPart) return label;                       // no prompt suffix
  const num = promptPart.replace(/^prompt/i, "").trim();   // "3" or ""
  return num 
    // if number is present, return "o1 · Prompt 3"
    ? `${label} · Prompt ${num}`  
    // if no number, just return "o1 · Prompt"
    : `${label} · Prompt`;       
}

export const metricGridStyles = (nModels: number): React.CSSProperties => ({
  display: "grid",

  gridTemplateColumns: `16px 220px repeat(${nModels}, 120px)`,  // Increased from 100px to 120px for model columns

  columnGap: 20,  // Increased from 12 to 20 to create more space between model columns
  rowGap: 6,
  alignItems: "center",
});

/** Safe JSON.parse – returns undefined on failure (single source of truth) */
export function safeJsonParse(payload: unknown) {
  if (typeof payload !== 'string') return undefined;
  try { return JSON.parse(payload); }
  catch { return undefined; }
}
