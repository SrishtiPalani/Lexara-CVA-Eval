export const VIZ_METRICS = [
  'dataFidelity', 'fieldSimilarity',
  'filterAccuracy', 'sortAccuracy',
  'chartTypeAcc', 'chartSimilarity',
  'xAxisAcc', 'yAxisAcc',
  'aestheticAccuracy', 'tooltipAcc',
] as const;

export const NL_METRICS  = [
  'information_similarity',
  'assumptions', 'insightfulness',
  'follow_up_relevance', 'coherence',
] as const;

export const SPEC_METRICS = ['precision', 'recall', 'f1'] as const;

/** ------------------------------------------------------------------
 *  Metric trees used by the selector UI
 *  ------------------------------------------------------------------*/
export const METRIC_TREE = {
  viz: {
    title: 'Visualization Response Metrics',
    children: {
      data:          ['dataFidelity', 'fieldSimilarity'],
      semantics:     ['chartSimilarity'],
      functionality: ['filterAccuracy','sortAccuracy','xAxisAcc','yAxisAcc'],
      design:        ['aestheticAccuracy','tooltipAcc'],
    }
  },
  nl: {
    title: 'Natural Language Response Metrics',
    children: {
      factualGrounding:      ['information_similarity'],
      analyticalThinking:    ['assumptions','insightfulness'],
      conversationalQuality: ['follow_up_relevance','coherence'],
    }
  }, 
  spec: {
    title: 'Traditional NLG Metrics',
    children: {
      f1: ['precision','recall'],
    }
  }
} as const;
