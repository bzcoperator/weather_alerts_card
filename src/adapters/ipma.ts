import { AlertAdapter, AlertProvider, AlertSeverity, WeatherAlert } from '../types';
import { parseTimestamp } from '../utils';

// IPMA (Instituto Português do Mar e da Atmosfera, Portugal) via the HA core
// `ipma` integration's `weather_alert` sensor. Its state is the awareness
// colour; its attributes are the raw IPMA warning fields. The core sensor
// reports only the first active warning (`warnings[0]`), so one entity is one
// alert. Upstream text is Portuguese; the event name is translated here.

const AWARENESS_SEVERITY: Record<string, AlertSeverity> = {
  green: 'minor',
  yellow: 'moderate',
  orange: 'severe',
  red: 'extreme',
};

// Keys are IPMA `awarenessTypeName` values as the API publishes them.
// Unmapped types fall through untranslated rather than being guessed.
const TYPE_NAMES_EN: Record<string, string> = {
  'Vento': 'Wind',
  'Chuva': 'Rain',
  'Neve': 'Snow',
  'Trovoada': 'Thunderstorm',
  'Nevoeiro': 'Fog',
  'Calor': 'Heat',
  'Frio': 'Cold',
  'Agitação marítima': 'Coastal swell',
  'Tempo quente': 'Hot weather',
  'Tempo frio': 'Cold weather',
};

const LEVEL_LABELS: Record<string, string> = {
  green: 'Minor',
  yellow: 'Moderate',
  orange: 'Severe',
  red: 'Extreme',
};

export class IpmaAdapter implements AlertAdapter {
  provider: AlertProvider = 'ipma';

  // Each entity is a single warning with no CAP `id`, so the id is synthesised
  // from area, type and start time. It is not stable across providers.
  stableIds = false;

  // Detection needs all three keys. An idle sensor publishes no warning
  // attributes, so it is not auto-detected: set `provider: ipma` for it.
  canHandle(attributes: Record<string, unknown>): boolean {
    return typeof attributes['awarenessLevelID'] === 'string'
      && typeof attributes['awarenessTypeName'] === 'string'
      && typeof attributes['idAreaAviso'] === 'string';
  }

  parseAlerts(attributes: Record<string, unknown>): WeatherAlert[] {
    const level = str(attributes['awarenessLevelID']).toLowerCase();
    const typeRaw = str(attributes['awarenessTypeName']);
    const area = str(attributes['idAreaAviso']);
    if (!level || !typeRaw) return [];

    const severity = AWARENESS_SEVERITY[level] ?? 'unknown';
    const event = TYPE_NAMES_EN[typeRaw] ?? typeRaw;
    const onsetTs = parseTimestamp(str(attributes['startTime']));
    const endsTs = parseTimestamp(str(attributes['endTime']));
    const text = str(attributes['text']);

    return [{
      id: `ipma_${area}_${typeRaw}_${onsetTs}`,
      event,
      severity,
      severityLabel: LEVEL_LABELS[level] ?? '',
      certainty: '',
      urgency: '',
      sentTs: 0,
      onsetTs,
      endsTs,
      description: text,
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
    }];
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
