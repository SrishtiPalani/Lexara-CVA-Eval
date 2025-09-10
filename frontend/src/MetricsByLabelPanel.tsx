import React, { useMemo, useState, useEffect } from 'react';
import { Card, Typography, Space, Checkbox, Tooltip, Divider, Skeleton, Badge, Rate } from 'antd';
import { BarChartOutlined, QuestionCircleOutlined, FilterOutlined, CaretRightOutlined, DownOutlined } from '@ant-design/icons';
import { EvaluationDataRecord, MetricsByLabelPanelProps } from './types';
import { averageMetrics, MetricScores, computeVisualizationSubcategoryScores, computeOverallVisualizationScore } from './metrics';
import { metricsToDisplay } from './TestCaseEvaluation';
import { badgeStyle } from './TestCaseEvaluation';
import { judgeMetricsInfo } from './NaturalLanguageOverallMetrics';


const { Title, Text } = Typography;

/**
 * Helper function to determine if a metric should be displayed as stars
 */
const isStarMetric = (metricKey: string): boolean => {
  return ['assumptions', 'insightfulness', 'follow_up_relevance', 'coherence'].includes(metricKey);
};

/**
 * Helper function to convert percentage back to star rating (0-5 scale)
 */
const percentageToStars = (percentage: number): number => {
  return percentage / 20; // Convert from 0-100 scale back to 0-5 scale
};

/**
 * Helper function to determine if a subcategory should be displayed as stars
 */
const isStarSubcategory = (categoryKey: string, subcategoryKey: string): boolean => {
  if (categoryKey !== 'nl') return false;
  return ['analyticalThinking', 'conversationalQuality'].includes(subcategoryKey);
};

/**
 * Interface for tracking which utterances are tagged with each label
 */
interface LabelUtteranceInfo {
  count: number;
  utterances: Array<{
    testNumber: number;
    turnNumber: number; // idx + 1 for display
    utterance: string;
  }>;
}

/**
 * Label categories with their associated labels and styling
 */
interface LabelCategory {
  name: string;
  labels: string[];
  color: string;
  icon: React.ReactNode;
  description: string;
}

const labelCategories: LabelCategory[] = [
  {
    name: "Chart Types",
    labels: ["Bar Chart", "Line Chart", "Multi-Line Chart", "Box and Whiskers Chart", "Scatter Chart", "Histogram"],
    color: "#1890ff",
    icon: <BarChartOutlined />,
    description: "Performance across different visualization types"
  },
  {
    name: "Ambiguity Types",
    labels: ["Semantic Ambiguity", "Pragmatic Ambiguity", "Syntactic Ambiguity"],
    color: "#52c41a", 
    icon: <QuestionCircleOutlined />,
    description: "Performance on different types of ambiguous queries"
  },
  {
    name: "Context Handling",
    labels: [
      "Context Handling: Ellipsis / Slot Filling",
      "Context Handling: Spec-Edit Carryover", 
      "Context Handling: Filter / Scope Carryover",
      "Context Handling: Reference Resolution",
      "Context Handling: Level of Detail"
    ],
    color: "#722ed1",
    icon: <FilterOutlined />,
    description: "Performance on different context handling scenarios"
  },
  {
    name: "Turn Numbers",
    labels: ["Turn Number: 1", "Turn Number: 2", "Turn Number: 3"],
    color: "#fa8c16",
    icon: <BarChartOutlined />,
    description: "Performance across conversation turns"
  }
];

/**
 * Enhanced metric card interface that includes all available metrics
 */
interface MetricCard {
  label: string;
  category: string;
  model: string;
  // Overall scores (highest level)
  overallVizScore: number;
  overallNLGScore: number;
  overallNLScore: number;
  // Subcategory scores (medium level)
  vizSubcategoryAvg: number;
  nlgSubcategoryAvg: number;
  nlSubcategoryAvg: number;
  // Traditional NLG metrics (lowest level)
  precision: number;
  recall: number;
  f1: number;
  // Visualization metrics (lowest level)
  dataFidelity: number;
  fieldSimilarity: number;
  filterAccuracy: number;
  sortAccuracy: number;
  chartTypeAcc: number;
  chartSimilarity: number;
  xAxisAcc: number;
  yAxisAcc: number;
  aestheticAccuracy: number;
  tooltipAcc: number;
  // Natural language metrics (lowest level)
  information_similarity: number;
  assumptions: number;
  insightfulness: number;
  follow_up_relevance: number;
  coherence: number;
}

/**
 * Model anonymization mapping
 */
const modelNameMap: Record<string, string> = {
  "gpt-5": "Model A",
  "gpt-5-mini": "Model B", 
  "gpt-5-nano": "Model C",
  "gpt-4.1": "Model D",
  "4o": "Model E",
  "o3": "Model F",
  "o4-mini": "Model G",
  "claude-sonnet": "Model H",
  "claude-opus": "Model I",
  "deepseek-r1": "Model J"
};



/**
 * Metric categories for organization - using the hierarchical structure from METRIC_TREE
 */
const metricCategories = {
  viz: {
    name: "Visualization Response Metrics",
    color: '#1890ff',
    children: {
      data: {
        name: "Data",
        metrics: ['dataFidelity', 'fieldSimilarity'],
        definition: "Accuracy of data selection and field mapping"
      },
      semantics: {
        name: "Semantics", 
        metrics: ['chartSimilarity'],
        definition: "Chart type selection and semantic appropriateness"
      },
      functionality: {
        name: "Functionality",
        metrics: ['filterAccuracy', 'sortAccuracy', 'xAxisAcc', 'yAxisAcc'],
        definition: "Filtering, sorting, and axis configuration"
      },
      design: {
        name: "Design",
        metrics: ['aestheticAccuracy', 'tooltipAcc'],
        definition: "Visual encodings and interactivity"
      }
    }
  },
  nl: {
    name: "Natural Language Response Metrics",
    color: '#52c41a',
    children: {
      factualGrounding: {
        name: "Factual Grounding",
        metrics: ['information_similarity'],
        definition: "Semantic similarity to expected response"
      },
      analyticalThinking: {
        name: "Analytical Thinking",
        metrics: ['assumptions', 'insightfulness'],
        definition: "Depth of analysis and assumption disclosure"
      },
      conversationalQuality: {
        name: "Conversational Quality",
        metrics: ['follow_up_relevance', 'coherence'],
        definition: "Context awareness and response coherence"
      }
    }
  },
  spec: {
    name: "Traditional NLG Metrics",
    color: '#722ed1',
    children: {
      f1: {
        name: "F1 Metrics",
        metrics: ['precision', 'recall'],
        definition: "Precision and recall scores"
      }
    }
  }
};

const MetricsByLabelPanel: React.FC<MetricsByLabelPanelProps> = ({
  evaluationData,
  selectedModels,
  judgeModel,
}) => {
  /**
   * Check if all evaluations are complete
   */
  const areAllEvaluationsComplete = useMemo(() => {
    if (!evaluationData || evaluationData.length === 0) {
      return false;
    }

    // Check if all records have metrics for all selected models
    return evaluationData.every(record => {
      if (!record.metrics) {
        return false;
      }
      
      return selectedModels.every(model => {
        const modelMetrics = record.metrics?.[model];
        return modelMetrics && Object.keys(modelMetrics).length > 0;
      });
    });
  }, [evaluationData, selectedModels]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    'Chart Types', 'Ambiguity Types', 'Context Handling', 'Turn Numbers'
  ]);
  const [selectedMetricTypes, setSelectedMetricTypes] = useState<string[]>([
    'viz', 'nl', 'spec'
  ]);
  // Initialize all expanded states as true (open by default)
  const [expandedBuckets, setExpandedBuckets] = useState<Record<string, boolean>>({});
  const [expandedLabels, setExpandedLabels] = useState<Record<string, boolean>>({});
  const [expandedOverall, setExpandedOverall] = useState<Record<string, boolean>>({});

  // Initialize all expanded states as true when data is available
  useEffect(() => {
    if (evaluationData.length > 0) {
      // Initialize all labels as expanded
      const initialLabels: Record<string, boolean> = {};
      const initialOverall: Record<string, boolean> = {};
      const initialBuckets: Record<string, boolean> = {};

      // Get all unique labels from the data
      const allLabels = new Set<string>();
      evaluationData.forEach(record => {
        if (record.labels) {
          record.labels.forEach(label => allLabels.add(label));
        }
      });

      // Initialize all labels as expanded
      allLabels.forEach(label => {
        initialLabels[label] = true;
      });

      // Initialize all overall categories as expanded
      Object.keys(metricCategories).forEach(categoryKey => {
        initialOverall[categoryKey] = true;
      });

      // Initialize all buckets as expanded
      Object.keys(metricCategories).forEach(categoryKey => {
        const category = metricCategories[categoryKey as keyof typeof metricCategories];
        if (category) {
          Object.keys(category.children).forEach(bucketKey => {
            allLabels.forEach(label => {
              initialBuckets[`${label}-${categoryKey}-${bucketKey}`] = true;
            });
          });
        }
      });

      setExpandedLabels(initialLabels);
      setExpandedOverall(initialOverall);
      setExpandedBuckets(initialBuckets);
    }
  }, [evaluationData]);

  // Update selected metric types based on judge model selection
  useEffect(() => {
    // Always include 'nl' since we still want to show information similarity even without judge model
    setSelectedMetricTypes(['viz', 'nl', 'spec']);
  }, [judgeModel]);

  /**
   * Calculate label utterance information - which utterances are tagged with each label
   */
  const labelUtteranceInfo = useMemo<Record<string, LabelUtteranceInfo>>(() => {
    const labelInfo: Record<string, LabelUtteranceInfo> = {};

    evaluationData.forEach((record: EvaluationDataRecord) => {
      if (!record.labels || record.labels.length === 0) {
        return;
      }

      const testNumber = record.test_number || 0;
      const turnNumber = (record.idx || 0) + 1; // Convert 0-based idx to 1-based turn number
      const utterance = record.input || '';

      record.labels.forEach((label) => {
        if (!labelInfo[label]) {
          labelInfo[label] = {
            count: 0,
            utterances: []
          };
        }

        labelInfo[label].count++;
        labelInfo[label].utterances.push({
          testNumber,
          turnNumber,
          utterance
        });
      });
    });

    return labelInfo;
  }, [evaluationData]);

    /**
   * Aggregate metrics by label and model for all available metrics
   * FIXED: Now properly aggregates by label, not mixing all labels together
   * ENHANCED: Now includes hierarchical aggregation at subcategory and overall levels
   */
  const labelModelMetrics = useMemo<MetricCard[]>(() => {
    const results: MetricCard[] = [];

    // Get all unique labels from the data
    const allLabels = new Set<string>();
    evaluationData.forEach(record => {
      if (record.labels) {
        record.labels.forEach(label => allLabels.add(label));
      }
    });

    // For each label, filter records that have that label and aggregate metrics
    allLabels.forEach(label => {
      // Filter records that have this label
      const recordsWithLabel = evaluationData.filter(record => 
        record.labels && record.labels.includes(label)
      );

      if (recordsWithLabel.length === 0) return;

      selectedModels.forEach(realModelName => {
        const friendlyName = modelNameMap[realModelName] || realModelName;

        // Find which category this label belongs to
        const category = labelCategories.find(cat => 
          cat.labels.includes(label)
        )?.name || 'Other';

        // Collect all metrics for this model across records with this label
        const metricsArray: MetricScores[] = [];
        const judgeEvaluations: any[] = [];

        recordsWithLabel.forEach(record => {
          // Use metric_averages if available, otherwise fall back to metrics
          const modelScores = record.metric_averages?.[realModelName] || record.metrics?.[realModelName];
          if (modelScores) {
            metricsArray.push(modelScores);
          }

          // Collect judge evaluations only if a judge model is selected
          if (judgeModel && record.judge_evaluations) {
            const judgeEvaluation = record.judge_evaluations[judgeModel]?.[realModelName];
            if (judgeEvaluation) {
              judgeEvaluations.push(judgeEvaluation);
            }
          }
        });

        if (metricsArray.length === 0) return;

        // Average the metrics
        const avg = averageMetrics(metricsArray);

        // Calculate judge evaluation averages
        let judgeAvg = { assumptions: 0, insightfulness: 0, followUpRelevance: 0, coherence: 0 };
        
        if (judgeEvaluations.length > 0) {
          // Use raw judge evaluations if available
          judgeAvg = {
            assumptions: judgeEvaluations.reduce((sum, judgeEval) => sum + (judgeEval.assumptions || 0), 0) / judgeEvaluations.length,
            insightfulness: judgeEvaluations.reduce((sum, judgeEval) => sum + (judgeEval.insightfulness || 0), 0) / judgeEvaluations.length,
            followUpRelevance: judgeEvaluations.reduce((sum, judgeEval) => sum + (judgeEval.follow_up_relevance || 0), 0) / judgeEvaluations.length,
            coherence: judgeEvaluations.reduce((sum, judgeEval) => sum + (judgeEval.coherence || 0), 0) / judgeEvaluations.length,
          };
        }

        // Calculate hierarchical averages
        const vizScores = computeVisualizationSubcategoryScores(avg, selectedMetricTypes);
        const overallVizScore = computeOverallVisualizationScore(avg, selectedMetricTypes);

        // Calculate subcategory averages for each metric type
        const vizSubcategoryAvg = Object.values(vizScores).reduce((sum: number, score: number) => sum + score, 0) / Object.keys(vizScores).length;
        const nlgSubcategoryAvg = (avg.score_precision_recall_f1.precision + avg.score_precision_recall_f1.recall + avg.score_precision_recall_f1.f1) / 3;
        
        // Calculate NL subcategory average only if judge model is selected
        let nlSubcategoryAvg = 0;
        if (judgeModel) {
          nlSubcategoryAvg = (judgeAvg.assumptions + judgeAvg.insightfulness + judgeAvg.followUpRelevance + judgeAvg.coherence) / 4;
        }

        results.push({
          label,
          category,
          model: friendlyName, 
          // Overall scores (highest level)
          overallVizScore: overallVizScore * 100,
          overallNLGScore: nlgSubcategoryAvg * 100,
          overallNLScore: nlSubcategoryAvg * 20, // Convert 1-5 scale to 0-100
          // Subcategory scores (medium level)
          vizSubcategoryAvg: vizSubcategoryAvg * 100,
          nlgSubcategoryAvg: nlgSubcategoryAvg * 100,
          nlSubcategoryAvg: nlSubcategoryAvg * 20,
          // Traditional NLG metrics (lowest level)
          precision: avg.score_precision_recall_f1.precision * 100,
          recall: avg.score_precision_recall_f1.recall * 100,
          f1: avg.score_precision_recall_f1.f1 * 100,
          // Visualization metrics (lowest level)
          dataFidelity: avg.data_fidelity * 100,
          fieldSimilarity: avg.field_similarity * 100,
          filterAccuracy: avg.filter_accuracy * 100,
          sortAccuracy: avg.sort_accuracy * 100,
          chartTypeAcc: avg.chart_type_accuracy * 100,
          chartSimilarity: avg.chart_similarity * 100,
          xAxisAcc: avg.axis.x_axis_accuracy * 100,
          yAxisAcc: avg.axis.y_axis_accuracy * 100,
          aestheticAccuracy: avg.aesthetic_accuracy * 100,
          tooltipAcc: avg.interactivity.tooltip_accuracy * 100,
          // Natural language metrics (lowest level)
          information_similarity: avg.information_similarity * 100,
          assumptions: judgeModel ? judgeAvg.assumptions * 20 : 0, // Convert 1-5 scale to 0-100
          insightfulness: judgeModel ? judgeAvg.insightfulness * 20 : 0,
          follow_up_relevance: judgeModel ? judgeAvg.followUpRelevance * 20 : 0,
          coherence: judgeModel ? judgeAvg.coherence * 20 : 0
        });
      });
    });

    return results;
  }, [evaluationData, selectedModels, selectedMetricTypes, judgeModel]);

  /**
   * Group metrics by label for side-by-side model comparison
   */
  const labelGroups = useMemo(() => {
    const groups: Record<string, MetricCard[]> = {};
    labelModelMetrics.forEach(card => {
      if (!groups[card.label]) {
        groups[card.label] = [];
      }
      groups[card.label].push(card);
    });
    return groups;
  }, [labelModelMetrics]);



  /**
   * Get metric value for a specific card and metric key
   */
  const getMetricValue = (card: MetricCard, metricKey: string) => {
    const value = card[metricKey as keyof MetricCard] as number;
    return isNaN(value) ? 0 : value;
  };

  /**
   * Calculate subcategory average for a single card (per model|prompt)
   */
  const getSubcategoryAverage = (card: MetricCard, categoryKey: string, subcategoryKey: string) => {
    const category = metricCategories[categoryKey as keyof typeof metricCategories];
    if (!category) return 0;
    
    const children = category.children as Record<string, { metrics: string[] }>;
    if (!children[subcategoryKey]) return 0;
    
    const metrics = children[subcategoryKey].metrics;
    const total = metrics.reduce((metricSum: number, metricKey: string) => {
      return metricSum + getMetricValue(card, metricKey);
    }, 0);
    
    return total / metrics.length;
  };

  /**
   * Calculate overall category average for a single card (per model|prompt)
   */
  const getOverallCategoryAverage = (card: MetricCard, categoryKey: string) => {
    const category = metricCategories[categoryKey as keyof typeof metricCategories];
    if (!category) return 0;
    
    const children = category.children as Record<string, { metrics: string[] }>;
    const subcategories = Object.keys(children);
    
    // Filter out LLM-as-judge subcategories if no judge model is selected
    const validSubcategories = subcategories.filter(subcategoryKey => {
      if (categoryKey === 'nl' && !judgeModel && ['analyticalThinking', 'conversationalQuality'].includes(subcategoryKey)) {
        return false;
      }
      return true;
    });
    
    if (validSubcategories.length === 0) return 0;
    
    const total = validSubcategories.reduce((sum: number, subcategoryKey: string) => {
      return sum + getSubcategoryAverage(card, categoryKey, subcategoryKey);
    }, 0);
    
    return total / validSubcategories.length;
  };

  /**
   * Render hierarchical metric structure for a card group (multiple models)
   */
  const renderHierarchicalMetrics = (cards: MetricCard[]) => {
    return (
      <div style={{ 
        marginTop: 16, 
        width: '100%'
      }}>
        {selectedMetricTypes.map(categoryKey => {
          const category = metricCategories[categoryKey as keyof typeof metricCategories];
          if (!category) return null;
          
          // Don't skip the natural language category - we still want to show information similarity

          const isOverallExpanded = expandedOverall[`${cards[0].label}-${categoryKey}`];

          return (
            <div key={categoryKey} style={{ 
              marginBottom: 16, 
              width: '100%'
            }}>
              {/* Column headers for model|prompt */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                marginBottom: 8,
                padding: '4px 0',
                width: '100%'
              }}>
                <div style={{ 
                  width: '180px', 
                  fontSize: '11px', 
                  color: '#555',
                  fontWeight: '500',
                  flexShrink: 0
                }}>
                  Metric
                </div>
                <div style={{ 
                  display: 'flex', 
                  gap: 6, 
                  flex: 1,
                  justifyContent: 'flex-end'
                }}>
                  {cards.map(card => (
                    <div key={card.model} style={{ 
                      fontSize: '11px', 
                      color: '#555', 
                      textAlign: 'center',
                      fontWeight: '500',
                      width: '120px',
                      flexShrink: 0
                    }}>
                      {card.model}
                    </div>
                  ))}
                </div>
              </div>

              {/* Overall category row (highest level) */}
              <div
                onClick={() => setExpandedOverall(prev => ({ 
                  ...prev, 
                  [`${cards[0].label}-${categoryKey}`]: !prev[`${cards[0].label}-${categoryKey}`]
                }))}
                style={{ 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 6,
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                  marginBottom: 8,
                  width: '100%'
                }}
              >
                {isOverallExpanded
                  ? <DownOutlined style={{ fontSize: 12 }} />
                  : <CaretRightOutlined style={{ fontSize: 12 }} />}
                <span style={{ 
                  fontSize: '13px', 
                  fontWeight: 'bold',
                  color: category.color,
                  width: '180px',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  {category.name}
                  <Tooltip title={`Overall ${category.name} performance across all subcategories`}>
                    <QuestionCircleOutlined style={{ fontSize: 11, color: '#999' }} />
                  </Tooltip>
                </span>
                {/* Show individual model scores for overall category */}
                <div style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                  {cards.map(card => {
                    const overallAvg = getOverallCategoryAverage(card, categoryKey);
                    return (
                      <Tooltip key={card.model} title={`${card.model} overall ${category.name} performance`}>
                        <div style={{ 
                          ...badgeStyle(overallAvg), 
                          padding: '2px 6px', 
                          borderRadius: 4, 
                          fontSize: '11px',
                          fontWeight: 'bold',
                          width: '120px',
                          flexShrink: 0,
                          textAlign: 'center'
                        }}>
                          {Math.round(overallAvg)}%
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>

              </div>

              {/* Subcategory rows (medium level) */}
              {isOverallExpanded && Object.entries(category.children).map(([bucketKey, bucket]) => {
                // Skip LLM-as-judge subcategories if no judge model is selected
                if (categoryKey === 'nl' && !judgeModel && ['analyticalThinking', 'conversationalQuality'].includes(bucketKey)) {
                  return null;
                }
                
                const isOpen = expandedBuckets[`${cards[0].label}-${categoryKey}-${bucketKey}`];
                
                return (
                  <div key={bucketKey} style={{ marginLeft: 16, marginBottom: 8 }}>
                    {/* Subcategory header */}
                    <div
                      onClick={() => setExpandedBuckets(prev => ({ 
                        ...prev, 
                        [`${cards[0].label}-${categoryKey}-${bucketKey}`]: !prev[`${cards[0].label}-${categoryKey}-${bucketKey}`]
                      }))}
                      style={{ 
                        cursor: 'pointer', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 6,
                        padding: '4px 0',
                        width: '100%'
                      }}
                    >
                      {isOpen
                        ? <DownOutlined style={{ fontSize: 12 }} />
                        : <CaretRightOutlined style={{ fontSize: 12 }} />}
                      <span style={{ 
                        fontSize: '12px', 
                        fontWeight: '500',
                        width: '180px',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        {bucket.name}
                        <Tooltip title={bucket.definition}>
                          <QuestionCircleOutlined style={{ fontSize: 11, color: '#999' }} />
                        </Tooltip>
                      </span>
                      {/* Show individual model scores for subcategory */}
                      <div style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                        {cards.map(card => {
                          const subcategoryAvg = getSubcategoryAverage(card, categoryKey, bucketKey);
                          
                          // Display stars for LLM-as-judge subcategories, percentages for others
                          if (isStarSubcategory(categoryKey, bucketKey)) {
                            const starValue = percentageToStars(subcategoryAvg);
                            return (
                              <Tooltip key={card.model} title={`${card.model} ${bucket.name} performance: ${starValue.toFixed(1)}/5 stars`}>
                                <div style={{ 
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '120px',
                                  flexShrink: 0,
                                  padding: '2px 6px'
                                }}>
                                  <Rate
                                    disabled
                                    allowHalf
                                    value={starValue}
                                    style={{ fontSize: 12 }}
                                  />
                                </div>
                              </Tooltip>
                            );
                          } else {
                            return (
                              <Tooltip key={card.model} title={`${card.model} ${bucket.name} performance`}>
                                <div style={{ 
                                  ...badgeStyle(subcategoryAvg), 
                                  padding: '2px 6px', 
                                  borderRadius: 4, 
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                  width: '120px',
                                  flexShrink: 0,
                                  textAlign: 'center'
                                }}>
                                  {Math.round(subcategoryAvg)}%
                                </div>
                              </Tooltip>
                            );
                          }
                        })}
                      </div>

                    </div>

                    {/* Individual metrics (lowest level) */}
                    {isOpen && (
                      <div style={{ marginLeft: 20, marginTop: 8 }}>
                        {bucket.metrics.map(metricKey => {
                          const metricDef = metricsToDisplay.find(m => m.key === metricKey) || 
                                          judgeMetricsInfo.find(m => m.key === metricKey);
                          if (!metricDef) return null;
                          
                          return (
                            <div key={metricKey}                             style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: 6,
                              padding: '4px 0',
                              marginBottom: 4,
                              width: '100%'
                            }}>
                              <span style={{ 
                                fontSize: '11px', 
                                fontWeight: '500',
                                width: '180px',
                                flexShrink: 0,
                                color: '#333',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6
                              }}>
                                {metricDef.label}
                                <Tooltip title={metricDef.definition}>
                                  <QuestionCircleOutlined style={{ fontSize: 11, color: '#999' }} />
                                </Tooltip>
                              </span>
                              {/* Show individual model scores for metric */}
                              <div style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                                {cards.map(card => {
                                  const value = getMetricValue(card, metricKey);
                                  
                                  // Display stars for LLM-as-judge metrics, percentages for others
                                  if (isStarMetric(metricKey)) {
                                    const starValue = percentageToStars(value);
                                    return (
                                      <Tooltip key={card.model} title={`${card.model} ${metricDef.label} performance: ${starValue.toFixed(1)}/5 stars`}>
                                        <div style={{ 
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          width: '120px',
                                          flexShrink: 0,
                                          padding: '2px 6px'
                                        }}>
                                          <Rate
                                            disabled
                                            allowHalf
                                            value={starValue}
                                            style={{ fontSize: 12 }}
                                          />
                                        </div>
                                      </Tooltip>
                                    );
                                  } else {
                                    return (
                                      <Tooltip key={card.model} title={`${card.model} ${metricDef.label} performance`}>
                                        <div style={{ 
                                          ...badgeStyle(value), 
                                          padding: '2px 6px', 
                                          borderRadius: 4, 
                                          fontSize: '11px',
                                          fontWeight: 'bold',
                                          width: '120px',
                                          flexShrink: 0,
                                          textAlign: 'center'
                                        }}>
                                          {Math.round(value)}%
                                        </div>
                                      </Tooltip>
                                    );
                                  }
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  /**
   * Render a single metric card with multiple models side by side
   */
  const renderMetricCard = (cards: MetricCard[]) => {
    if (cards.length === 0) return null;
    
    const category = labelCategories.find(cat => cat.name === cards[0].category);
    const isExpanded = expandedLabels[cards[0].label];
    
    return (
      <Card
        key={cards[0].label}
        size="small"
        style={{ 
          marginBottom: 16,
          borderLeft: `4px solid ${category?.color || '#d9d9d9'}`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          transition: 'all 0.3s ease',
          display: 'inline-block',
          minWidth: 'fit-content'
        }}
        bodyStyle={{ 
          padding: '12px'
        }}
        hoverable
        title={
          <div
            onClick={() => setExpandedLabels(prev => ({ 
              ...prev, 
              [cards[0].label]: !prev[cards[0].label]
            }))}
            style={{ cursor: 'pointer' }}
          >
            <Space>
              <span style={{ color: category?.color }}>{category?.icon}</span>
              <Text strong style={{ fontSize: '14px' }}>{cards[0].label}</Text>
              {(() => {
                const utteranceInfo = labelUtteranceInfo[cards[0].label];
                if (utteranceInfo) {
                  const tooltipContent = (
                    <div>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Utterances tagged with this label:</strong>
                      </div>
                      {utteranceInfo.utterances.map((item, index) => (
                        <div key={index} style={{ marginBottom: 4, fontSize: '12px' }}>
                          <strong>Test {item.testNumber}, Turn {item.turnNumber}:</strong>
                          <div style={{ marginLeft: 8, color: '#666', fontStyle: 'italic' }}>
                            "{item.utterance.length > 50 ? item.utterance.substring(0, 50) + '...' : item.utterance}"
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                  
                  return (
                    <Tooltip title={tooltipContent} placement="top">
                      <Badge 
                        count={utteranceInfo.count} 
                        style={{ 
                          backgroundColor: category?.color || '#d9d9d9',
                          cursor: 'pointer'
                        }}
                      />
                    </Tooltip>
                  );
                }
                return null;
              })()}
              {isExpanded
                ? <DownOutlined style={{ fontSize: 12 }} />
                : <CaretRightOutlined style={{ fontSize: 12 }} />}
            </Space>
          </div>
        }
      >


        {/* Hierarchical breakdown */}
        {isExpanded && renderHierarchicalMetrics(cards)}
      </Card>
    );
  };

  /**
   * Render a category section
   */
  const renderCategorySection = (category: LabelCategory) => {
    const categoryLabels = Object.keys(labelGroups).filter(label => {
      const cards = labelGroups[label];
      return cards.length > 0 && cards[0].category === category.name;
    });
    
    if (categoryLabels.length === 0) return null;

    return (
      <div key={category.name} style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 16 }}>
          <div>
            <Title level={4} style={{ color: category.color, margin: 0 }}>
              {category.icon} {category.name}
            </Title>
            <Text type="secondary" style={{ display: 'block' }}>
              {category.description}
            </Text>
          </div>
        </div>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {categoryLabels.map(label => (
            <div key={label}>
              {renderMetricCard(labelGroups[label])}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Show loading skeleton until all evaluations are complete
  if (!areAllEvaluationsComplete) {
    return (
      <div style={{ padding: '16px', maxWidth: '1200px' }}>
        <Title level={3}>Metrics by Label Categories</Title>
        <div style={{ marginBottom: 24 }}>
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {[1, 2, 3].map(i => (
            <Card
              key={i}
              size="small"
              style={{ 
                marginBottom: 16,
                borderLeft: '4px solid #1890ff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                width: '300px'
              }}
              title={<Skeleton.Input active size="small" style={{ width: '150px' }} />}
            >
              <Skeleton active paragraph={{ rows: 8 }} />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', maxWidth: '1200px' }}>
      <Title level={3}>Metrics by Label Categories</Title>
      
      {/* Filters */}
      <Card size="small" style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text strong>Label Categories:</Text>
            <Checkbox.Group
              value={selectedCategories}
              onChange={(values) => setSelectedCategories(values as string[])}
              style={{ marginLeft: 16 }}
            >
              {labelCategories.map(cat => (
                <Checkbox key={cat.name} value={cat.name}>
                  {cat.name}
                </Checkbox>
              ))}
            </Checkbox.Group>
        </div>
          <Divider style={{ margin: '8px 0' }} />
          <div>
            <Text strong>Metric Types:</Text>
            <Checkbox.Group
              value={selectedMetricTypes}
              onChange={(values) => setSelectedMetricTypes(values as string[])}
              style={{ marginLeft: 16 }}
            >
              {Object.entries(metricCategories).map(([key, cat]) => (
                <Checkbox key={key} value={key}>
                  {cat.name}
                </Checkbox>
              ))}
            </Checkbox.Group>
          </div>
        </Space>
      </Card>

      {/* Category sections */}
      {labelCategories
        .filter(cat => selectedCategories.includes(cat.name))
        .map(category => renderCategorySection(category))
      }
    </div>
  );
};

export default MetricsByLabelPanel;
