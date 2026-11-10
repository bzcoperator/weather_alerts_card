import { AlertAdapter, AlertProvider, AlertSeverity, WeatherAlert } from '../types';
import { parseTimestamp } from '../utils';
import { IPMA_DISTRICT_GEOMETRY } from './ipma-districts';

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
  'Tempo Quente': 'Heat',
  'Tempo quente': 'Heat',
  'Tempo Frio': 'Cold',
  'Tempo frio': 'Cold',
};

// District codes (`idAreaAviso`) to names. Unknown codes fall back to the code.
const AREA_NAMES: Record<string, string> = {
  AVR: 'Aveiro',
  BGC: 'Bragança',
  BJA: 'Beja',
  BRG: 'Braga',
  CBO: 'Castelo Branco',
  CBR: 'Coimbra',
  EVR: 'Évora',
  FAR: 'Faro',
  GDA: 'Guarda',
  LRA: 'Leiria',
  LSB: 'Lisboa',
  PTG: 'Portalegre',
  PTO: 'Porto',
  SNT: 'Santarém',
  STB: 'Setúbal',
  VCT: 'Viana do Castelo',
  VIS: 'Viseu',
  VRL: 'Vila Real',
};

// District bounding boxes [minlon, minlat, maxlon, maxlat], derived from the
// georef-portugal-distrito 2021 boundaries (joaohumbg1/portugal_geojsons).
// Drives the mini-map frame; no polygon. Islands have no entry.
// CBO, PTG, SNT and STB codes are not yet confirmed against a live IPMA warning.
const DISTRICT_BBOX: Record<string, [number, number, number, number]> = {
  AVR: [-8.784, 40.279, -8.089, 41.080],
  BGC: [-7.432, 41.025, -6.189, 41.993],
  BJA: [-8.820, 37.319, -6.931, 38.331],
  BRG: [-8.812, 41.319, -7.811, 41.821],
  CBO: [-8.293, 39.537, -6.864, 40.416],
  CBR: [-8.909, 39.924, -7.732, 40.520],
  EVR: [-8.658, 38.155, -7.107, 39.027],
  FAR: [-8.997, 36.962, -7.393, 37.529],
  GDA: [-7.849, 40.230, -6.781, 41.179],
  LRA: [-9.517, 39.212, -8.108, 40.090],
  LSB: [-9.501, 38.673, -8.782, 39.318],
  PTG: [-8.344, 38.751, -6.951, 39.664],
  PTO: [-8.789, 41.001, -7.876, 41.472],
  SNT: [-9.002, 38.731, -7.809, 39.839],
  STB: [-9.263, 37.749, -8.130, 38.845],
  VCT: [-8.881, 41.606, -8.083, 42.154],
  VIS: [-8.359, 40.323, -7.305, 41.215],
  VRL: [-8.119, 41.119, -7.171, 41.927],
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
  const code = area.toUpperCase();
  const bbox = DISTRICT_BBOX[code];

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
    // IPMA publishes no per-warning page; link the area's forecast page.
    url: area ? `https://www.ipma.pt/pt/otempo/prev-sam/?p=${code}` : '',
    headline: event,
    areaDesc: AREA_NAMES[code] ?? code,
    zones: area ? [code] : [],
    eventCode: '',
    provider: 'ipma',
    iconHint: event,
    phase: '',
    ...(bbox && { bbox }),
    ...(IPMA_DISTRICT_GEOMETRY[code] && { geometry: IPMA_DISTRICT_GEOMETRY[code] }),
    severityInferred: AWARENESS_SEVERITY[level] === undefined,
    certaintyInferred: false,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
