import { AlertAdapter, AlertProvider, AlertSeverity, WeatherAlert } from '../types';
import { parseTimestamp } from '../utils';

// IPMA (Instituto Português do Mar e da Atmosfera, Portugal). Two shapes:
//
// - a list: `attributes.warnings`, one raw IPMA warning per item (the NWS
//   pattern). Every non-green warning becomes an alert.
// - a single warning as flat attributes, which is what the HA core `ipma`
//   `weather_alert` sensor exposes today (it reports only the first warning).
//
// IPMA publishes no `sent`, `certainty` or `urgency`, so those stay empty.

const AWARENESS_SEVERITY: Record<string, AlertSeverity> = {
  green: 'minor',
  yellow: 'moderate',
  orange: 'severe',
  red: 'extreme',
};

// Keys are IPMA `awarenessTypeName` values. Unmapped types pass through.
const TYPE_NAMES_EN: Record<string, string> = {
  'Vento': 'Wind',
  'Chuva': 'Rain',
  'Precipitação': 'Precipitation',
  'Neve': 'Snow',
  'Trovoada': 'Thunderstorm',
  'Nevoeiro': 'Fog',
  'Calor': 'Heat',
  'Frio': 'Cold',
  'Agitação Marítima': 'Coastal swell',
  'Agitação marítima': 'Coastal swell',
  'Tempo Quente': 'Hot weather',
  'Tempo quente': 'Hot weather',
  'Tempo Frio': 'Cold weather',
  'Tempo frio': 'Cold weather',
};

const LEVEL_LABELS: Record<string, string> = {
  green: 'Minor',
  yellow: 'Moderate',
  orange: 'Severe',
  red: 'Extreme',
};

type Raw = Record<string, unknown>;

export class IpmaAdapter implements AlertAdapter {
  provider: AlertProvider = 'ipma';

  // Ids are synthesised from area, type and start time, so they are not stable
  // across providers.
  stableIds = false;

  canHandle(attributes: Record<string, unknown>): boolean {
    if (isSingle(attributes)) return true;
    const list = attributes['warnings'];
    return Array.isArray(list) && list.some(isWarning);
  }

  parseAlerts(attributes: Record<string, unknown>): WeatherAlert[] {
    const list = attributes['warnings'];
    if (Array.isArray(list) && list.some(isWarning)) {
      return list
        .filter(isWarning)
        .filter(w => str(w['awarenessLevelID']).toLowerCase() !== 'green')
        .map(toAlert)
        .filter((a): a is WeatherAlert => a !== undefined);
    }
    if (isSingle(attributes)) {
      const alert = toAlert(attributes);
      return alert ? [alert] : [];
    }
    return [];
  }
}

// Single-warning form: the three detection keys must all be present.
function isSingle(a: Raw): boolean {
  return typeof a['awarenessLevelID'] === 'string'
    && typeof a['awarenessTypeName'] === 'string'
    && typeof a['idAreaAviso'] === 'string';
}

// A list item is an IPMA warning if it carries the level and type keys.
function isWarning(v: unknown): v is Raw {
  return !!v && typeof v === 'object'
    && typeof (v as Raw)['awarenessLevelID'] === 'string'
    && typeof (v as Raw)['awarenessTypeName'] === 'string';
}

function toAlert(w: Raw): WeatherAlert | undefined {
  const level = str(w['awarenessLevelID']).toLowerCase();
  const typeRaw = str(w['awarenessTypeName']);
  const area = str(w['idAreaAviso']);
  if (!level || !typeRaw) return undefined;

  const onsetTs = parseTimestamp(str(w['startTime']));
  const endsTs = parseTimestamp(str(w['endTime']));
  const event = TYPE_NAMES_EN[typeRaw] ?? typeRaw;

  return {
    id: `ipma_${area}_${typeRaw}_${level}_${onsetTs}`,
    event,
    severity: AWARENESS_SEVERITY[level] ?? 'unknown',
    severityLabel: LEVEL_LABELS[level] ?? '',
    certainty: '',
    urgency: '',
    sentTs: 0,
    onsetTs,
    endsTs,
    description: str(w['text']),
    instruction: '',
    url: '',
    headline: event,
    areaDesc: '',
    zones: area ? [area.toUpperCase()] : [],
    eventCode: '',
    provider: 'ipma',
    iconHint: typeRaw,
    phase: '',
    severityInferred: AWARENESS_SEVERITY[level] === undefined,
    certaintyInferred: false,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
