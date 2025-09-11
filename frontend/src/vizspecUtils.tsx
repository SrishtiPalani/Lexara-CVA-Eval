/**
 * This module contains utility functions for converting a notional specification 
 * into a Vega-Lite specification, applying data filters, and describing
 * the resulting visualization.
 **/
import { VisualizationSpec } from 'vega-embed';
import { TopLevelSpec } from 'vega-lite';
import { NotionalSpec, DatasourceField } from './types';

/* A set of possible mark types recognized by Vega-Lite. These define the basic 
 * "shape" or geometry used for plotting (e.g., bar, line, point, etc.).
 */
type Mark = 
  'area' 
  | 'bar' 
  | 'circle' 
  | 'line' 
  | 'point' 
  | 'rect' 
  | 'rule' 
  | 'square' 
  | 'text' 
  | 'tick' 
  | 'trail' 
  | 'geoshape' 
  | 'boxplot' 
  | 'errorbar' 
  | 'errorband' 
  | 'arc';

/**
 * The allowed projection types if using geospatial data in Vega-Lite.
 */
type ProjectionType = 
  "albers" 
  | "albersUsa" 
  | "azimuthalEqualArea" 
  | "azimuthalEquidistant"
  | "conicConformal" 
  | "conicEqualArea" 
  | "conicEquidistant" 
  | "equirectangular"
  | "gnomonic" 
  | "identity" 
  | "mercator" 
  | "orthographic" 
  | "stereographic"
  | "transverseMercator";


type UnitLikeSpec = TopLevelSpec & {
  mark?: any;                             
  encoding?: Record<string, any>;
  transform?: any[];
};

/** 
 * A small helper function to convert a string to lowercase and trim whitespace.
 * Useful for case-insensitive comparisons, especially for matching field names.
 */
function normalizeString(str: string) {
  return str.trim().toLowerCase();
}

/** 
 * Determines the Vega-Lite field type ('quantitative', 'temporal', 'nominal')
 * based on the field's metadata. For example, fields with data type 'number'
 * are considered 'quantitative'.
 */
function getVegaLiteType(field: any): 'quantitative' | 'nominal' | 'temporal' {
  switch (field.data) {
    case 'number':
      return 'quantitative';
    case 'date':
      return 'temporal';
    default:
      return 'nominal';
  }
}

/**
 * A set of valid temporal aggregation strings (e.g., 'year', 'month'). 
 * Helps us check whether an aggregation is time-based.
 */
const TEMPORAL_AGGREGATIONS = new Set([
  'year', 'qtr', 'month', 'week', 'day', 'hour', 'minute', 'second'
]);

/**
 * Used when pivoting multiple measure fields for a stacked or multi-measure scenario.
 * The new pivoted columns become MEASURE_NAME and MEASURE_VALUE in the data.
 */
const PIVOT_FIELDS = {
  MEASURE_NAME: 'MeasureName',
  MEASURE_VALUE: 'MeasureValue',
};

/**
 * A record of U.S. states and their capital city coordinates. This is used when 
 * the data has a "State" field but no direct lat/lon. We can look up a state's 
 * lat/lon for symbol maps.
 */
const stateCapitals: Record<string, { lat: number; lon: number }> = {
  "Alabama": { lat: 32.377716, lon: -86.300568 },
  "Alaska": { lat: 58.301598, lon: -134.420212 },
  "Arizona": { lat: 33.448377, lon: -112.074037 },
  "Arkansas": { lat: 34.746481, lon: -92.289595 },
  "California": { lat: 38.576668, lon: -121.493629 },
  "Colorado": { lat: 39.739236, lon: -104.984862 },
  "Connecticut": { lat: 41.765, lon: -72.673 },
  "Delaware": { lat: 39.158168, lon: -75.524368 },
  "Florida": { lat: 30.438118, lon: -84.280733 },
  "Georgia": { lat: 33.749, lon: -84.388 },
  "Hawaii": { lat: 21.306944, lon: -157.858333 },
  "Idaho": { lat: 43.615, lon: -116.202 },
  "Illinois": { lat: 39.801717, lon: -89.643710 },
  "Indiana": { lat: 39.768403, lon: -86.158068 },
  "Iowa": { lat: 41.586835, lon: -93.624959 },
  "Kansas": { lat: 39.048191, lon: -95.677956 },
  "Kentucky": { lat: 38.197274, lon: -84.86311 },
  "Louisiana": { lat: 30.45809, lon: -91.140229 },
  "Maine": { lat: 44.307167, lon: -69.781693 },
  "Maryland": { lat: 38.978445, lon: -76.492183 },
  "Massachusetts": { lat: 42.358162, lon: -71.063698 },
  "Michigan": { lat: 42.7335, lon: -84.5467 },
  "Minnesota": { lat: 44.953703, lon: -93.089958 },
  "Mississippi": { lat: 32.298757, lon: -90.18481 },
  "Missouri": { lat: 38.5767, lon: -92.1735 },
  "Montana": { lat: 46.595805, lon: -112.027031 },
  "Nebraska": { lat: 40.813616, lon: -96.702595 },
  "Nevada": { lat: 39.163914, lon: -119.767403 },
  "New Hampshire": { lat: 43.208137, lon: -71.537994 },
  "New Jersey": { lat: 40.220596, lon: -74.769913 },
  "New Mexico": { lat: 35.68224, lon: -105.939728 },
  "New York": { lat: 42.65258, lon: -73.756233 },
  "North Carolina": { lat: 35.78043, lon: -78.639099 },
  "North Dakota": { lat: 46.808326, lon: -100.783739 },
  "Ohio": { lat: 39.96118, lon: -82.998794 },
  "Oklahoma": { lat: 35.46756, lon: -97.516428 },
  "Oregon": { lat: 44.942898, lon: -123.035096 },
  "Pennsylvania": { lat: 40.264378, lon: -76.883598 },
  "Rhode Island": { lat: 41.830914, lon: -71.414963 },
  "South Carolina": { lat: 34.000, lon: -81.0348 },
  "South Dakota": { lat: 44.367031, lon: -100.346405 },
  "Tennessee": { lat: 36.162663, lon: -86.781601 },
  "Texas": { lat: 30.266667, lon: -97.733330 },
  "Utah": { lat: 40.760780, lon: -111.891045 },
  "Vermont": { lat: 44.260059, lon: -72.575388 },
  "Virginia": { lat: 37.540725, lon: -77.436048 },
  "Washington": { lat: 47.037874, lon: -122.900696 },
  "West Virginia": { lat: 38.349819, lon: -81.632623 },
  "Wisconsin": { lat: 43.074684, lon: -89.384445 },
  "Wyoming": { lat: 41.140259, lon: -104.820236 }
};

/**
 * Checks if a given aggregation string belongs to the set of known temporal
 * aggregations (e.g., 'year', 'month').
 */
function isTemporalAggregation(agg?: string): boolean {
  return !!agg && TEMPORAL_AGGREGATIONS.has(agg);
}

/**
 * Given an encodings object and a predicate, returns the name of the first 
 * channel whose definition satisfies that predicate. For example, finding 
 * which channel has type="nominal".
 */
function getEncodingChannel(encodings: Record<string, any>, predicate: (enc: any) => boolean): string | undefined {
  return Object.keys(encodings).find(ch => predicate(encodings[ch]));
}

/**
 * Finds the channel that encodes a specific field name.
 */
function getEncodingChannelForField(encodings: Record<string, any>, fieldName: string): string | undefined {
  return Object.keys(encodings).find(ch => encodings[ch].field === fieldName);
}

/**
 * Finds the channel for a given type (e.g., 'nominal' or 'quantitative').
 */
function getEncodingChannelByType(encodings: Record<string, any>, type: string): string | undefined {
  return Object.keys(encodings).find(ch => encodings[ch].type === type);
}

/**
 * Translates a chart type (e.g., 'bar', 'line', 'scatterplot') into a
 * corresponding Vega-Lite Mark. If the chart type is unsupported, an error
 * is added to the errors array.
 */
function determineMark(chartType: string | undefined, errors: string[]): Mark {
  let mark: Mark = 'bar'; // default fallback

  if (!chartType) return mark;

  switch (chartType) {
    case 'bar':
    case 'stackedbar':
      mark = 'bar';
      break;
    case 'line':
    case 'dualline':
      mark = 'line';
      break;
    case 'scatterplot':
      mark = 'point';
      break;
    case 'text':
      mark = 'text';
      break;
    case 'histogram':
      mark = 'bar';
      break;
    case 'boxplot':
      mark = 'boxplot';
      break;
    case 'symbolmap':
      mark = 'geoshape';
      break;
    case 'bubble':
      mark = 'circle';
      break;
    case 'filledmap':
      mark = 'geoshape';
      break;
    default:
      errors.push(`Unsupported chart type: ${chartType}`);
  }

  return mark;
}

/**
 * Assigns encoding channels (x, y, color, etc.) to the given fields based on 
 * their roles ('dimension' vs. 'measure'). If a field has an explicit 'encoding' 
 * property, we use that. Otherwise, we infer it. Also applies any aggregation 
 * (e.g., sum, avg, or timeUnit) if specified on the field.
 */
function assignEncodings(fields: any[], errors: string[]): Record<string, any> {
  const encodings: Record<string, any> = {};

  for (const field of fields) {
    const vlType = getVegaLiteType(field);
    let channel = field.encoding;

    // If no channel is specified, infer one
    if (!channel) {
      if (field.role === 'dimension' && !encodings.x) {
        channel = 'x';
      } else if (field.role === 'measure' && !encodings.y) {
        channel = 'y';
      } else if (!encodings.x) {
        channel = 'x';
      } else if (!encodings.y) {
        channel = 'y';
      } else if (!encodings.color) {
        channel = 'color';
      } else {
        errors.push(`Could not determine encoding channel for field ${field.caption}`);
        continue;
      }
    }

    // Build the encoding definition
    const encoding: any = { field: field.caption, type: vlType };
    // Apply aggregations if needed
    if (field.role === 'measure') {
      if (isTemporalAggregation(field.aggregation)) {
        encoding.timeUnit = field.aggregation;
        encoding.type = 'temporal';
      } else {
        encoding.aggregate = field.aggregation;
      }
    }

    encodings[channel] = encoding;
  }

  return encodings;
}

/**
 * If the chart is a "text" mark and we have not assigned a text channel, 
 * pick a dimension field or the first available field as the text source.
 * Also sets an x-axis title if missing.
 */
function ensureTextEncoding(
  chartType: string | undefined, 
  encodings: Record<string, any>, 
  fields: any[], 
  errors: string[]
) {
  if (chartType !== 'text') return;

  if (!encodings.text) {
    const dimensionField = fields.find(f => f.role === 'dimension');
    if (dimensionField) {
      encodings.text = { field: dimensionField.caption, type: getVegaLiteType(dimensionField) };
    } else if (fields.length > 0) {
      encodings.text = { field: fields[0].caption, type: getVegaLiteType(fields[0]) };
    } else {
      errors.push('No fields available to encode as text.');
    }
  }

  // Provide a default axis title
  if (encodings.x && !encodings.x.title) {
    encodings.x.title = encodings.x.field;
  }
}

/**
 * For line or dualline charts, ensures that x is a temporal or dimension field 
 * and y is a quantitative measure. If multiple measures exist, a warning is 
 * generated and the first measure is used by default.
 */
function ensureLineChartEncodings(
  chartType: string | undefined,
  encodings: Record<string, any>,
  fields: any[],
  errors: string[]
) {
  if (chartType !== 'line' && chartType !== 'dualline') return;

  // Partition fields into dimension vs. measure (quantitative)
  const dimensionFields = fields.filter(f => f.role === 'dimension');
  const measureFields = fields.filter(f => f.role === 'measure' && getVegaLiteType(f) === 'quantitative');

  // Ensure x is temporal or at least a dimension
  if (!encodings.x) {
    const temporalField = dimensionFields.find(f => getVegaLiteType(f) === 'temporal');
    if (temporalField) {
      encodings.x = { field: temporalField.caption, type: 'temporal' };
    } else if (dimensionFields.length > 0) {
      encodings.x = { field: dimensionFields[0].caption, type: getVegaLiteType(dimensionFields[0]) };
      errors.push('No temporal dimension found for x-axis; using first available dimension.');
    } else {
      errors.push('Line chart requires at least one dimension field for the x-axis.');
    }
  } else {
    // Optionally force x to be temporal
    if (encodings.x.type !== 'temporal') {
      errors.push('For line charts, it is recommended that the x-axis be temporal.');
    }
  }

  // Ensure y is a measure
  if (measureFields.length === 0) {
    errors.push('Line chart requires at least one quantitative measure for the y-axis.');
  } else if (measureFields.length === 1) {
    // Assign the single measure to y if not already set
    if (!encodings.y) {
      encodings.y = { field: measureFields[0].caption, type: 'quantitative' };
    } else if (encodings.y.type !== 'quantitative') {
      errors.push('The y-axis encoding must be quantitative for a line chart.');
    }
  } else {
    // Multiple measures scenario
    errors.push('Multi-measure line charts are not fully supported yet; using the first measure for y-axis.');
    if (!encodings.y) {
      encodings.y = { field: measureFields[0].caption, type: 'quantitative' };
    }
  }
}

/**
 * For scatter plots, both x and y must be quantitative. This function ensures 
 * at least two numeric measures are available. If absent, it logs an error.
 */
function ensureScatterPlotEncodings(
  chartType: string | undefined,
  encodings: Record<string, any>,
  fields: any[],
  errors: string[]
) {
  // X-axis
  if (!encodings.x) {
    const candidateX = fields.find(f => f.role === 'measure' && getVegaLiteType(f) === 'quantitative');
    if (candidateX) {
      encodings.x = { field: candidateX.caption, type: 'quantitative' };
    } else {
      errors.push("Scatter plot requires a quantitative x-axis field.");
    }
  } else if (encodings.x.type !== 'quantitative') {
    encodings.x.type = 'quantitative';
  }

  // Y-axis
  if (!encodings.y) {
    const candidateY = fields.find(
      f => f.role === 'measure' && getVegaLiteType(f) === 'quantitative' && f.caption !== encodings.x.field
    );
    if (candidateY) {
      encodings.y = { field: candidateY.caption, type: 'quantitative' };
    } else {
      errors.push("Scatter plot requires a quantitative y-axis field.");
    }
  } else if (encodings.y.type !== 'quantitative') {
    encodings.y.type = 'quantitative';
  }
}

/**
 * A boxplot requires at least one quantitative measure (for y) and at least 
 * one dimension (for x). Additional dimension fields can go into 'detail'. 
 * Optionally, extra measure fields can be added to 'tooltip'.
 */
function ensureBoxplotEncodings(
  chartType: string | undefined,
  encodings: Record<string, any>,
  fields: any[],
  errors: string[]
) {
  if (chartType !== 'boxplot') return;
  
  const dimensionFields = fields.filter(f => f.role === 'dimension');
  const measureFields = fields.filter(f => f.role === 'measure' && getVegaLiteType(f) === 'quantitative');

  if (measureFields.length === 0) {
    errors.push('Boxplot requires at least one quantitative measure for the y-axis.');
    return;
  }

  // Single measure assigned to y
  if (measureFields.length === 1) {
    if (!encodings.y) {
      encodings.y = { field: measureFields[0].caption, type: 'quantitative' };
    } else {
      encodings.y.type = 'quantitative';
    }
  }

  // X-axis requires at least one dimension
  if (dimensionFields.length === 0) {
    errors.push('Boxplot requires at least one dimension field for the x-axis.');
    return;
  }
  if (!encodings.x) {
    encodings.x = { field: dimensionFields[0].caption, type: 'nominal' };
  } else {
    encodings.x.type = 'nominal';
  }

  // Additional dimensions: put them in 'detail'
  if (dimensionFields.length > 1) {
    encodings.detail = dimensionFields.slice(1).map(f => ({ field: f.caption, type: 'nominal' }));
  }

  // Optionally, for a single measure boxplot, extra measures could go to tooltip
  if (measureFields.length > 1 && !encodings.tooltip) {
    encodings.tooltip = measureFields.slice(1).map(f => ({ field: f.caption, type: 'quantitative' }));
  }
}

/**
 * If a bar chart doesn't have a measure field, we fall back to an implicit 
 * "count" aggregation, ensuring that each bar at least represents something.
 */
function ensureMeasureForBarChart(
  chartType: string | undefined, 
  encodings: Record<string, any>, 
  notionalSpec: NotionalSpec
) {
  if (chartType === 'bar') {
    const hasMeasure = Object.values(encodings).some(enc => enc.aggregate || enc.type === 'quantitative');
    if (!hasMeasure) {
      let chosenAggregation: string | undefined;
      let chosenField: string | undefined;

      // Attempt to find an aggregation and field from range filters, if present
      if (notionalSpec.rangeFilters) {
        for (const filter of notionalSpec.rangeFilters) {
          if (filter.aggregation && filter.field) {
            chosenAggregation = filter.aggregation;
            chosenField = filter.field;
            break;
          }
        }
      }

      // If found, use that measure; otherwise default to count
      if (chosenAggregation && chosenField) {
        encodings.y = { aggregate: chosenAggregation, field: chosenField, type: "quantitative" };
      } else {
        encodings.y = { aggregate: "count", type: "quantitative" };
      }
    }
  }
}

/**
 * For stacked bars, if multiple measure fields are present, pivot them into 
 * (MeasureName, MeasureValue). Then assign color to MeasureName and sum 
 * of MeasureValue for the y-axis. This function modifies both the data 
 * (filteredData) and the encodings to support stacked representation.
 */
function handleStackedBar(
  chartType: string | undefined,
  fields: any[],
  encodings: Record<string, any>,
  filteredData: any[],
  errors: string[]
): any[] {
  if (chartType !== 'stackedbar') return filteredData;

  // Separate measure and dimension fields
  const measureFields = fields.filter(f => f.role === 'measure');
  const dimensionFields = fields.filter(f => f.role === 'dimension');

  if (measureFields.length === 0) {
    errors.push('Stacked bar chart requires at least one measure field.');
    return filteredData;
  }
  if (dimensionFields.length === 0) {
    errors.push('Stacked bar chart requires at least one dimension field.');
    return filteredData;
  }
  if (errors.length > 0) return filteredData;

  // If multiple measures, pivot them
  if (measureFields.length > 1) {
    // Identify which dimension channel is used (usually x)
    const xDim = getEncodingChannel(encodings, enc => enc.type !== 'quantitative' && enc.field);
    if (!xDim) {
      errors.push('Stacked bar chart requires a dimension on x to group bars.');
      return filteredData;
    }

    // Pivot data from wide to long
    const pivotedData = filteredData.flatMap((row: any) => {
      return measureFields.map(mf => {
        let val = row[mf.caption];
        if (val == null || val === '' || isNaN(val)) val = 0;
        return {
          ...row,
          MeasureName: mf.caption,
          MeasureValue: Number(val)
        };
      });
    });

    // Remove the original measure encodings
    for (const mField of measureFields) {
      const ch = getEncodingChannelForField(encodings, mField.caption);
      if (ch) {
        delete encodings[ch];
      }
    }

    // Reassign x, y, and color for stacked layout
    const xFieldName = encodings[xDim].field;
    encodings.x = { field: xFieldName, type: encodings[xDim].type };
    encodings.y = { field: "MeasureValue", type: "quantitative", stack: "zero", aggregate: "sum" };
    encodings.color = { field: "MeasureName", type: "nominal" };
    encodings.y.title = "Sum of Measures";

    // Filter out rows where dimension fields might be null or empty
    return pivotedData.filter(d => {
      return dimensionFields.every(dim => d[dim.caption] != null && d[dim.caption] !== '');
    });

  } else {
    // Single measure stacking scenario
    const xEnc = getEncodingChannel(encodings, enc => encodings.x);
    const yEnc = getEncodingChannel(encodings, enc => enc.type === 'quantitative' && enc.field);
    const colorEnc = getEncodingChannel(encodings, enc => enc.field && enc.type === 'nominal' && enc !== xEnc);

    if (!xEnc || !yEnc) {
      errors.push('Stacked bar chart requires a dimension on x and a measure on y.');
    }
    if (!colorEnc) {
      errors.push('Stacked bar chart requires a color encoding to stack by another dimension.');
    }

    if (errors.length === 0 && yEnc) {
      if (!encodings[yEnc].aggregate) {
        encodings[yEnc].aggregate = "sum";
      }
      encodings[yEnc].stack = "zero";
      const singleMeasureField = measureFields[0];
      encodings[yEnc].title = `Sum of ${singleMeasureField.caption}`;
    }
  }

  return filteredData;
}

/**
 * If the notionalSpec specifies a sort order, apply it to the relevant 
 * dimension encoding channel so that categories appear in ascending or 
 * descending order by the chosen aggregation (or timeUnit).
 */
function applySorting(notionalSpec: NotionalSpec, encodings: Record<string, any>) {
  if (!notionalSpec.sort) return;

  const direction = notionalSpec.sort.direction === 'desc' ? 'descending' : 'ascending';
  const sortField = notionalSpec.sort.by;
  const agg = notionalSpec.sort.aggregation;
  let sortObj: any = { order: direction };

  // Decide whether we apply an aggregation operator or a timeUnit
  if (agg && agg !== 'default') {
    if (['sum', 'avg', 'max', 'min', 'median', 'count', 'countd'].includes(agg)) {
      sortObj.field = sortField;
      sortObj.op = agg === 'countd' ? 'distinct' : agg;
    } else if (isTemporalAggregation(agg)) {
      sortObj.field = sortField;
      sortObj.timeUnit = agg;
    } else {
      sortObj.field = sortField;
    }
  } else {
    sortObj.field = sortField;
  }

  // Try to apply this sort to a nominal field
  const dimensionEnc = getEncodingChannelByType(encodings, 'nominal');
  if (dimensionEnc) {
    encodings[dimensionEnc].sort = sortObj;
  } else {
    // If we can't find a nominal channel, fallback to x or y if they're nominal
    if (encodings.x && encodings.x.type === 'nominal') {
      encodings.x.sort = sortObj;
    } else if (encodings.y && encodings.y.type === 'nominal') {
      encodings.y.sort = sortObj;
    }
  }
}

/**
 * Returns a filter transform object that checks if a field is neither null nor ''.
 */
function createNotNullFilter(field: string): any {
  return {
    filter: `datum['${field}'] != null && datum['${field}'] !== ''`
  };
}

/**
 * Generates not-null filters for every dimension field. 
 * Each dimension must be present and non-empty in the data.
 */
function applyNotNullToAllDimensionFields(fields: any[], transforms: any[]) {
  fields.forEach(fld => {
    if (fld.role === 'dimension' && fld.caption) {
      transforms.push(createNotNullFilter(fld.caption));
    }
  });
}

/**
 * Constants related to date/time computations
 */
const DAYS_IN_WEEK = 7;
const MONTHS_IN_QUARTER = 3;

/**
 * Adjusts a given 'start' date by some amount and period (days, weeks, months,
 * quarters, or years), in either the positive or negative direction. 
 * Used for relative date filters.
 */
function adjustStartDate(start: Date, period: string, amount: number, multiplier: number): void {
  const dayAdjustments: Record<string, number> = {
    days: 1,
    weeks: DAYS_IN_WEEK,
  };

  if (period in dayAdjustments) {
    start.setDate(start.getDate() + multiplier * -amount * dayAdjustments[period]);
  } else if (period === 'months' || period === 'quarters') {
    const monthAdjustment = period === 'quarters' ? MONTHS_IN_QUARTER : 1;
    start.setMonth(start.getMonth() + multiplier * -amount * monthAdjustment);
  } else if (period === 'years') {
    start.setFullYear(start.getFullYear() + multiplier * -amount);
  } else {
    console.warn(`Unknown period: ${period}`);
    // If unknown, do nothing
  }
}

/**
 * Given an amount, period (days, weeks, months, quarters, years), and direction
 * (e.g., 'previous' or 'next'), compute the correct start/end dates for that 
 * relative range. E.g., "previous 3 months" returns a start date ~3 months 
 * before now, up to the current date.
 */
function computeRelativeDateRange(amount: number, period: string, direction: string): {start: Date, end: Date} {
  const now = new Date();
  let start = new Date(now.getTime());
  let end = new Date(now.getTime());
  
  const multiplier = direction === 'previous' ? -1 : 1;

  adjustStartDate(start, period, amount, multiplier);

  // For "previous", the range is [start, now]
  // For "next", the range is [now, future]
  if (direction === 'previous') {
    end = now;
  } else {
    const tmp = start;
    start = now;
    end = tmp;
  }

  return { start, end };
}

/**
 * Utility for grouping data by 'groupField' and aggregating values in 'aggField'
 * using a specified aggregator (sum, avg, max, min, count).
 */
function aggregateByField(
  data: any[],
  groupField: string,
  aggField: string,
  aggType: string
): Map<string, number> {
  const groups = new Map<string, number[]>();

  // Group values into arrays by groupField
  for (const row of data) {
    const key = String(row[groupField]);
    const val = row[aggField];
    if (val != null && val !== '' && !isNaN(val)) {
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(Number(val));
    }
  }

  // Compute aggregator over each group
  const result = new Map<string, number>();
  for (const [key, values] of Array.from(groups.entries())) {
    let aggregated: number;
    switch (aggType) {
      case 'sum':
        aggregated = values.reduce((a, b) => a + b, 0);
        break;
      case 'avg':
        aggregated = values.reduce((a, b) => a + b, 0) / values.length;
        break;
      case 'max':
        aggregated = Math.max(...values);
        break;
      case 'min':
        aggregated = Math.min(...values);
        break;
      case 'count':
        aggregated = values.length;
        break;
      default:
        // Default to sum if aggregator not recognized
        aggregated = values.reduce((a, b) => a + b, 0);
        break;
    }
    result.set(key, aggregated);
  }

  return result;
}

/**
 * Given raw data and a NotionalSpec describing filters, this function:
 *  1) Builds predicate functions for each type of filter:
 *     - Categorical
 *     - Numeric Range
 *     - Date Range
 *     - Relative Date
 *  2) Applies these predicates to filter the dataset
 *  3) Handles limit filters (top/bottom N) after the main filters
 *  4) Returns the filtered dataset and filter descriptions
 */
export function applyFiltersToData(dataValues: any[], notionalSpec: NotionalSpec) {
  let filteredData = [...dataValues];
  const filterDescriptions: string[] = [];

  // Converts a value to a Date or returns null if invalid
  function toJSDate(val: any): Date | null {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // List of filter predicates to be ANDed together
  const predicates: ((d: any) => boolean)[] = [];

  // Whether we need to filter out null dimension fields
  let nullFilteringNeeded = false;

  // Converts a value to lowercase string or "null" if empty
  function normalizeValue(val: any): string {
    return val == null || val === '' ? 'null' : String(val).toLowerCase();
  }

  // Helper for ensuring a field is not null or empty
  function addNotNullPredicate(field: string) {
    nullFilteringNeeded = true;
    predicates.push(d => d[field] != null && d[field] !== '');
  }

  // ----- Apply Categorical Filters -----
  if (notionalSpec.categoricalFilters) {
    for (const filter of notionalSpec.categoricalFilters) {
      let desc = `${filter.field}`;
      const hasValues = filter.values && filter.values.length > 0;
      if (hasValues) {
        desc += filter.exclude ? `: not in [${filter.values!.join(', ')}]` : `: ${filter.values!.join(', ')}`;
      } else {
        desc += `: (no specific values)`;
      }
      filterDescriptions.push(desc);

      if (filter.includeNull === false || filter.includeNull == null)  {
        addNotNullPredicate(filter.field);
      }

      // If specific values are provided, create a set and either exclude or include them
      if (hasValues) {
        const setVals = new Set(filter.values!.map((v: string | number) => normalizeValue(v)));
        predicates.push(d => {
          const normalizedVal = normalizeValue(d[filter.field]);
          const included = setVals.has(normalizedVal);
          return filter.exclude ? !included : included;
        });
      }

      // Condition filters (e.g., field > value)
      if (filter.condition) {
        const { field, operator, value } = filter.condition;
        predicates.push(d => {
          const val = d[field];
          switch (operator) {
            case '>':  return val > value;
            case '>=': return val >= value;
            case '<':  return val < value;
            case '<=': return val <= value;
            case '==': return val === value;
            case '<>': return val !== value;
            default:   return true;
          }
        });
      }

      if (filter.includeNull === false || filter.includeNull == null)  {
        predicates.push(d => d[filter.field] != null && d[filter.field] !== '');
      }
    }
  }

  // ----- Apply Numeric Range Filters -----
  if (notionalSpec.rangeFilters) {
    for (const filter of notionalSpec.rangeFilters) {
      if (filter.type === 'numeric-range') {
        let desc = `${filter.field}`;
        if (filter.start !== undefined && filter.end !== undefined) {
          desc += `: greater than ${filter.start} and less than ${filter.end}`;
        } else if (filter.start !== undefined) {
          desc += `: greater than ${filter.start}`;
        } else if (filter.end !== undefined) {
          desc += `: less than ${filter.end}`;
        } else {
          desc += `: (no numeric bounds)`;
        }
        filterDescriptions.push(desc);

        if (filter.includeNull === false || filter.includeNull == null)  {
          addNotNullPredicate(filter.field);
        }

        predicates.push(d => {
          const val = d[filter.field];
          if (val == null || val === '') return false;
          if (filter.start !== undefined && val <= filter.start) return false;
          if (filter.end !== undefined && val >= filter.end)     return false;
          return true;
        });
      }
    }
  }

  // ----- Apply Date Range Filters -----
  if (notionalSpec.dateRangeFilters) {
    for (const filter of notionalSpec.dateRangeFilters) {
      let desc = `${filter.field}`;
      if (filter.start && filter.end) {
        desc += `: between ${filter.start} and ${filter.end}`;
      } else if (filter.start) {
        desc += `: after ${filter.start}`;
      } else if (filter.end) {
        desc += `: before ${filter.end}`;
      } else {
        desc += `: (no date range specified)`;
      }
      filterDescriptions.push(desc);

      if (filter.includeNull === false || filter.includeNull == null)  {
        addNotNullPredicate(filter.field);
      }

      predicates.push(d => {
        const dateVal = toJSDate(d[filter.field]);
        if (!dateVal) return false;
        if (filter.start && dateVal < new Date(filter.start)) return false;
        if (filter.end && dateVal > new Date(filter.end))     return false;
        return true;
      });
    }
  }

  // ----- Apply Relative Date Filters -----
  if (notionalSpec.relativeDateFilters) {
    for (const filter of notionalSpec.relativeDateFilters) {
      const desc = `${filter.field}: ${filter.direction} ${filter.amount} ${filter.period}`;
      filterDescriptions.push(desc);

      if (filter.includeNull === false || filter.includeNull == null)  {
        addNotNullPredicate(filter.field);
      }

      const { start, end } = computeRelativeDateRange(filter.amount, filter.period, filter.direction);
      predicates.push(d => {
        const dateVal = toJSDate(d[filter.field]);
        if (!dateVal) return false;
        return dateVal >= start && dateVal <= end;
      });
    }
  }

  // If nullFilteringNeeded is true, we ensure no dimension fields are null
  if (nullFilteringNeeded && notionalSpec.fields) {
    for (const f of notionalSpec.fields) {
      if (f.role === 'dimension') {
        predicates.push(d => d[f.caption] != null && d[f.caption] !== '');
      }
    }
  }

  // Apply each predicate in turn
  for (const pred of predicates) {
    filteredData = filteredData.filter(pred);
    if (filteredData.length === 0) break;
  }

  // ----- Apply Top/Bottom Limit Filters -----
  if (notionalSpec.categoricalFilters) {
    for (const filter of notionalSpec.categoricalFilters) {
      if (filter.limit && filter.limit.field && filter.limit.aggregation && filter.limit.limit) {
        const limitField = filter.limit.field;
        const limitAgg = filter.limit.aggregation;
        const limitCount = filter.limit.limit;
        const limitType = filter.limit.type; // 'top' or 'bottom'
        const groupField = filter.field;

        // Aggregate each category by limitField
        const aggMap = aggregateByField(filteredData, groupField, limitField, limitAgg);

        // Convert the aggregated map to an array and sort ascending
        let aggArray = Array.from(aggMap.entries());
        aggArray.sort((a, b) => a[1] - b[1]);

        // If 'top', reverse the sort (descending)
        if (limitType === 'top') {
          aggArray = aggArray.sort((a, b) => b[1] - a[1]);
        }

        // Keep only the top/bottom N categories
        const selectedCategories = new Set(aggArray.slice(0, limitCount).map(x => x[0]));
        filteredData = filteredData.filter(d => selectedCategories.has(String(d[groupField])));
      }
    }
  }

  // Return the filtered dataset and a list of descriptive filters
  return { filteredData, filterDescriptions };
}

/**
 * Once we've filtered the data, this function double-checks that dimension fields 
 * are not null, numeric fields are valid numbers, and temporal fields parse 
 * as valid dates (where required).
 */
function validateData(filteredData: any[], notionalSpec: NotionalSpec): any[] {
  const dimensionFields = notionalSpec.fields?.filter(f => f.role === 'dimension') || [];
  const measureFields = notionalSpec.fields?.filter(f => f.role === 'measure') || [];

  // Ensure dimension fields are non-empty
  filteredData = filteredData.filter(row => {
    return dimensionFields.every(dim => {
      const val = row[dim.caption];
      return val != null && val !== '';
    });
  });

  // Ensure measure fields are valid numbers if they're quantitative
  measureFields.forEach(mf => {
    if (getVegaLiteType(mf) === 'quantitative') {
      filteredData = filteredData.filter(row => {
        const val = row[mf.caption];
        return val == null || val === '' ? true : !isNaN(val);
      });
    }
  });

  // Ensure temporal fields are valid dates
  const temporalFields = notionalSpec.fields?.filter(f => getVegaLiteType(f) === 'temporal') || [];
  filteredData = filteredData.filter(row => {
    return temporalFields.every(tf => {
      const val = row[tf.caption];
      if (val == null || val === '') return true; 
      const d = new Date(val);
      return !isNaN(d.getTime());
    });
  });

  return filteredData;
}

/**
 * Main function that:
 *   1) Applies all filters
 *   2) Validates data
 *   3) Determines the appropriate Vega-Lite mark
 *   4) Assigns channels (x, y, color, etc.) from fields
 *   5) Handles chart types like symbol maps, stacked bars, multiple measures
 *   6) Returns the final Vega-Lite spec and any errors
 */
export const convertNotionalSpecToVegaSpec = (
  notionalSpec: NotionalSpec,
  datasourceFields: DatasourceField[],
  dataValues: any[]
): { vegaSpec: VisualizationSpec | null; errors: string[] } => {
  const errors: string[] = [];
  
  // 1) Apply filters, validate results
  const filterResult = applyFiltersToData(dataValues, notionalSpec);
  let filteredData = filterResult.filteredData;
  const filterDescriptions = filterResult.filterDescriptions;
  
  filteredData = validateData(filteredData, notionalSpec);
  if (filteredData.length === 0) {
    const detailedMessage = `No data results found for the selected filters: ${filterDescriptions.join(', ')}. Please try other criteria.`;
    return { vegaSpec: null, errors: [detailedMessage] };
  }
  
  // 2) Retrieve fields and determine the mark
  const fields = notionalSpec.fields || [];
  let mark = determineMark(notionalSpec.chart, errors);
  if (errors.length > 0) {
    return { vegaSpec: null, errors };
  }
  
  // 3) Assign encodings from fields
  const encodings = assignEncodings(fields, errors);
  if (errors.length > 0) {
    return { vegaSpec: null, errors };
  }
  
  // 4) Handle chart-specific logic
  ensureTextEncoding(notionalSpec.chart, encodings, fields, errors);
  if (errors.length > 0) {
    return { vegaSpec: null, errors };
  }
  
  // Symbol map is a special case
  if (notionalSpec.chart === 'symbolmap') {
    // We compute lat/lon from state, or expect lat/lon in the data
    const stateField = fields.find(f => normalizeString(f.caption) === "state");
    if (stateField) {
      // If state is found, attempt to map to capital lat/lon
      filteredData = filteredData.map(row => {
        const stateName = row[stateField.caption];
        const coords = stateCapitals[stateName];
        if (coords) {
          return { ...row, lat: coords.lat, lon: coords.lon };
        } else {
          return { ...row, lat: null, lon: null };
        }
      });
      filteredData = filteredData.filter(r => r.lat != null && r.lon != null);
      if (!filteredData.length) {
        errors.push('Symbol map: No valid lat/lon found via state lookup');
        return { vegaSpec: null, errors };
      }
    } else {
      // If no "state" field or lat/lon, we cannot proceed
      errors.push("Symbol map requires either a 'State' field or numeric lat/lon fields in the data");
      return { vegaSpec: null, errors };
    }

    // Return a specialized symbol map spec with circle marks
    const symbolMapSpec: TopLevelSpec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: filteredData },
      mark: 'circle',
      projection: { type: 'identity' },
      encoding: {
        longitude: { field: 'lon', type: 'quantitative' },
        latitude: { field: 'lat', type: 'quantitative' },
        // Example: If we want to show lat/lon in the tooltip
        tooltip: [
          { field: 'lon', type: 'quantitative' },
          { field: 'lat', type: 'quantitative' }
        ]
      },
      width: 600,
      height: 400
    };

    return { vegaSpec: symbolMapSpec, errors };
  }
  
  // For bar charts, ensure measure is set and handle stacked bars
  if (notionalSpec.chart === 'bar') {
    ensureMeasureForBarChart(notionalSpec.chart, encodings, notionalSpec);
    filteredData = handleStackedBar(notionalSpec.chart, fields, encodings, filteredData, errors);
    if (errors.length > 0) {
      return { vegaSpec: null, errors };
    }
  }
  
  // For line or dualline: pivot multiple measures if needed
  if (notionalSpec.chart === 'line' || notionalSpec.chart === 'dualline') {
    const measureFields = fields.filter(f => f.role === 'measure' && getVegaLiteType(f) === 'quantitative');
    if (measureFields.length > 1) {
      // Pivot multiple measure columns into (MeasureName, MeasureValue)
      const pivotedData = filteredData.flatMap((row: any) => {
        return measureFields.map(mf => {
          let val = row[mf.caption];
          if (val == null || val === '' || isNaN(val)) val = 0;
          return { ...row, MeasureName: mf.caption, MeasureValue: Number(val) };
        });
      });
      // Remove measure-specific channels from encodings
      for (const mf of measureFields) {
        const ch = getEncodingChannelForField(encodings, mf.caption);
        if (ch) {
          delete encodings[ch];
        }
      }
      // Reassign dimension fields to x, measure to y, color by measure name
      const dimensionFields = fields.filter(f => f.role === 'dimension');
      let xField: string | null = null;
      const temporalField = dimensionFields.find(f => getVegaLiteType(f) === 'temporal');
      if (temporalField) {
        xField = temporalField.caption;
        encodings.x = { field: xField, type: 'temporal', title: xField };
      } else if (dimensionFields.length > 0) {
        xField = dimensionFields[0].caption;
        encodings.x = { field: xField, type: getVegaLiteType(dimensionFields[0]), title: xField };
      } else {
        errors.push('Line chart requires at least one dimension field for the x-axis.');
        return { vegaSpec: null, errors };
      }
      encodings.y = { field: "MeasureValue", type: "quantitative", title: "Value" };
      encodings.color = { field: "MeasureName", type: "nominal", title: "Measure" };

      mark = 'line';
      filteredData = pivotedData;
    } else {
      // Single measure line chart
      ensureLineChartEncodings(notionalSpec.chart, encodings, fields, errors);
      if (errors.length > 0) {
        return { vegaSpec: null, errors };
      }
    }
  }
  
  // For scatter plots
  if (notionalSpec.chart === 'scatterplot') {
    ensureScatterPlotEncodings(notionalSpec.chart, encodings, fields, errors);
    if (errors.length > 0) {
      return { vegaSpec: null, errors };
    }
  }
  
  // For boxplots
  if (notionalSpec.chart === 'boxplot') {
    ensureBoxplotEncodings(notionalSpec.chart, encodings, fields, errors);
    if (errors.length > 0) return { vegaSpec: null, errors };

    // Pivot if multiple measure fields
    const measureFields = fields.filter(f => f.role === 'measure' && getVegaLiteType(f) === 'quantitative');
    if (measureFields.length > 1) {
      const pivotedData = filteredData.flatMap((row: any) =>
        measureFields.map(mf => {
          let val = row[mf.caption];
          if (val == null || val === '' || isNaN(val)) val = 0;
          return { ...row, MeasureName: mf.caption, MeasureValue: Number(val) };
        })
      );
      filteredData = pivotedData;

      encodings.y = { field: "MeasureValue", type: "quantitative" };
      encodings.color = { field: "MeasureName", type: "nominal" };

      // If no x encoding, pick the first dimension
      const dimensionFields = fields.filter(f => f.role === 'dimension');
      if (!encodings.x && dimensionFields.length > 0) {
        encodings.x = { field: dimensionFields[0].caption, type: 'nominal' };
      }
      // Additional dimensions in detail
      if (dimensionFields.length > 1) {
        encodings.detail = dimensionFields.slice(1).map(f => ({ field: f.caption, type: 'nominal' }));
      }
    }
  }
  
  // Histograms automatically bin the x channel
  if (notionalSpec.chart === 'histogram') {
    const quantitativeField = fields.find(
      (field) => field.role === 'measure' && getVegaLiteType(field) === 'quantitative'
    );
    if (!quantitativeField) {
      errors.push("Histogram requires at least one quantitative measure field.");
      return { vegaSpec: null, errors };
    }
    encodings.x = {
      field: quantitativeField.caption,
      type: 'quantitative',
      bin: true,
      title: quantitativeField.caption
    };
    encodings.y = {
      aggregate: 'count',
      type: 'quantitative',
      title: 'Count'
    };
    mark = 'bar';
  }
  
  // 5) Apply sorting
  applySorting(notionalSpec, encodings);
  
  // 6) Construct the final Vega-Lite spec
  const vegaSpec: TopLevelSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: { values: filteredData },
    mark,
    encoding: encodings
  };

  // For boxplots, skip adding safe tooltip if they already have it
  if (notionalSpec.chart !== 'boxplot') {
    addSafeTooltip(vegaSpec, errors);
  }

  return { vegaSpec, errors };
};

/**
 * Adds a tooltip channel to the spec based on existing encodings only (x, y, color,
 * etc.). By copying aggregator/bin/timeUnit, we avoid introducing new dimensions 
 * that would change grouping (especially for histograms).
 */
function addSafeTooltip(vegaSpec: TopLevelSpec, errors: string[]): void {
  // Ensure it's a single-view spec that actually has an encoding
  if (!('encoding' in vegaSpec)) return;
  const specWithEncoding = vegaSpec as TopLevelSpec & { encoding: Record<string, any> };

  if (!specWithEncoding.encoding) {
    specWithEncoding.encoding = {};
  }
  // If there's already a tooltip in the top-level encoding, skip
  if (specWithEncoding.encoding.tooltip) {
    return;
  }

  // Build a new tooltip array by cloning each single-field channel
  const newTooltip: any[] = [];
  for (const channel of Object.keys(specWithEncoding.encoding)) {
    const enc = specWithEncoding.encoding[channel];
    
    // Skip arrays or non-object encodings (e.g., detail: [])
    if (!enc || Array.isArray(enc) || typeof enc !== 'object') {
      continue;
    }

    // Clone the relevant field properties
    const { field, type, aggregate, timeUnit, bin } = enc;
    if (field) {
      const tooltipDef: any = { field, type };
      if (aggregate) {
        tooltipDef.aggregate = aggregate;
      }
      if (timeUnit) {
        tooltipDef.timeUnit = timeUnit;
      }
      if (bin) {
        tooltipDef.bin = bin;
      }

      newTooltip.push(tooltipDef);
    }
  }

  // If we found any single-field channels, attach them to tooltip
  if (newTooltip.length > 0) {
    specWithEncoding.encoding.tooltip = newTooltip;
  }
}

/**
 * Captures a Vega chart as an image (SVG or PNG)
 * @param vegaSpec - The Vega specification
 * @param dataValues - The data values for the chart
 * @param format - The output format ('svg' or 'png')
 * @returns Promise<string> - The image data as a data URL
 */
export const captureVegaChartAsImage = async (
  vegaSpec: VisualizationSpec,
  dataValues: any[],
  format: 'svg' | 'png' = 'svg'
): Promise<string> => {
  try {
    // Import Vega dynamically to avoid SSR issues
    const { parse } = await import('vega');
    const { View } = await import('vega');
    

    
    // Check if this is a Vega spec (has $schema with vega/v5) or Vega-Lite spec
    const isVegaSpec = vegaSpec.$schema && vegaSpec.$schema.includes('vega/v5');
    
    let runtime;
    if (isVegaSpec) {
      // This is a Vega spec - parse it directly
      runtime = parse(vegaSpec as any);
    } else {
      // This is a Vega-Lite spec - we need to compile it to Vega first
      const { compile } = await import('vega-lite');
      const vegaSpecCompiled = compile(vegaSpec as any).spec;
      runtime = parse(vegaSpecCompiled);
    }
    
    // Create a new view
    const view = new View(runtime);
    
    // Set the data based on the spec type
    if (isVegaSpec) {
      // For Vega specs, the data is usually already embedded in the spec
      // But we can override it if needed
      if (dataValues && dataValues.length > 0) {
        // Try to set data for the first dataset
        const runtimeAny = runtime as any;
        const firstDatasetName = runtimeAny.data?.[0]?.name;
        if (firstDatasetName) {
          view.data(firstDatasetName, dataValues);
        }
      }
    } else {
      // For Vega-Lite specs, set the data in the expected format
      if (dataValues && dataValues.length > 0) {
        view.data('data', dataValues);
      }
    }
    
    // Initialize the view
    await view.initialize();
    
    // Render the view
    await view.runAsync();
    
    // Export as SVG or PNG
    if (format === 'svg') {
      const svg = await view.toSVG();
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    } else {
      const canvas = await view.toCanvas();
      return canvas.toDataURL('image/png');
    }
  } catch (error) {
    console.error('Error capturing Vega chart:', error);
    throw new Error(`Failed to capture chart as ${format.toUpperCase()}: ${error}`);
  }
};

/**
 * Returns a plain-English description of a Vega-Lite spec that is
 * (a) numerically accurate, (b) transparent about assumptions, 
 * (c) insight-oriented (d) follow up contextually
 */
export function describeVegaSpec(
  vegaSpec: VisualizationSpec,
  dataValues: any[],
  prevContext?: string          
): string {
  if (!vegaSpec) return 'No visualization available.';

  const { mark, encoding = {}, transform = [] } = vegaSpec as UnitLikeSpec;
  const parts: string[] = [];

  /* ──────────────────── chart scaffold ──────────────────── */

  if (encoding.x?.field) parts.push(`The x‑axis shows **${encoding.x.field}**.`);
  if (encoding.y?.field) parts.push(`The y‑axis shows **${encoding.y.field}**.`);
  if (encoding.color?.field) parts.push(`Colour encodes **${encoding.color.field}**.`);
  if (encoding.size?.field)  parts.push(`Size encodes **${encoding.size.field}**.`);

  if (transform.some((t: any) => t.filter))
    parts.push('A filter is applied to the data.');

  /* ──────────────────── data‑driven insight ─────────────── */
  const xField = encoding.x?.field;
  const yField = encoding.y?.field;
  if (xField && yField && dataValues.length) {
    const agg = encoding.y.aggregate as string | undefined;
    const series: { key: any; value: number }[] = [];

    const add = (k: any, v: number) => {
      if (!isNaN(v)) series.push({ key: k, value: v });
    };

    if (agg && ['sum','avg','mean','min','max','median','count'].includes(agg)) {
      const buckets = new Map<any, number[]>();
      dataValues.forEach(r => {
        const v = Number(r[yField]); if (isNaN(v)) return;
        (buckets.get(r[xField]) ?? buckets.set(r[xField], []).get(r[xField])!).push(v);
      });

      buckets.forEach((vals, k) => {
        const sum = vals.reduce((a,b)=>a+b, 0);
        let v = sum;
        if (agg === 'avg' || agg === 'mean') v = sum / vals.length;
        else if (agg === 'min')  v = Math.min(...vals);
        else if (agg === 'max')  v = Math.max(...vals);
        else if (agg === 'median') {
          const s = [...vals].sort((a,b)=>a-b); const m = Math.floor(s.length/2);
          v = s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
        } else if (agg === 'count') v = vals.length;
        add(k, v);
      });
    } else {
      dataValues.forEach(r => add(r[xField], Number(r[yField])));
    }

    if (series.length) {
      const values = series.map(s => s.value);
      const max = Math.max(...values);
      const min = Math.min(...values);
      const top = series.find(s => s.value === max)!;
      const bottom = series.find(s => s.value === min)!;

      parts.push(
        `Values on the y‑axis range from **${min.toFixed(2)}** to **${max.toFixed(2)}**.`,
        `“${top.key}” is the highest (${max.toFixed(2)})${bottom.key !== top.key ? `, whereas “${bottom.key}” is the lowest (${min.toFixed(2)}).` : '.'}`
      );
    }

    /* 3. spell out assumptions */
    if (agg)
      parts.push(`*Assumption*: the chart shows **${agg}(${yField})** per **${xField}**.`);
  }

  return parts.join(' ');
}
