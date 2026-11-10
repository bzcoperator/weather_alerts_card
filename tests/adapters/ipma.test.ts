import { describe, it, expect } from 'vitest';
import { IpmaAdapter } from '../../src/adapters/ipma';
import { getAdapter } from '../../src/adapters';
import { getWeatherIcon, parseTimestamp } from '../../src/utils';

// Captured from sensor.oeiras_weather_alert (HA core ipma weather_alert sensor),
// Lisboa district, live response during the 2026-11-10 wind warning.
function capturedWind(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'Rajadas até 120 km/h, podendo atingir 140 km/h nos locais mais expostos.',
    awarenessTypeName: 'Vento',
    idAreaAviso: 'LSB',
    startTime: '2026-11-11 12:00:00',
    awarenessLevelID: 'red',
    endTime: '2026-11-11 21:00:00',
    friendly_name: 'Oeiras Weather Alert',
    ...overrides,
  };
}

describe('IpmaAdapter', () => {
  const adapter = new IpmaAdapter();

  describe('canHandle', () => {
    it('detects the captured IPMA payload', () => {
      expect(adapter.canHandle(capturedWind())).toBe(true);
    });

    it('does not detect an idle sensor with no warning attributes', () => {
      expect(adapter.canHandle({ friendly_name: 'Oeiras Weather Alert' })).toBe(false);
    });

    it('does not claim MeteoAlarm attributes', () => {
      expect(adapter.canHandle({
        awareness_level: '4; red; Extreme',
        awareness_type: '1; Wind',
        attribution: 'Information provided by MeteoAlarm',
      })).toBe(false);
    });
  });

  describe('parseAlerts', () => {
    it('parses the captured wind warning', () => {
      const [alert] = adapter.parseAlerts(capturedWind());
      expect(alert).toBeDefined();
      expect(alert.provider).toBe('ipma');
      expect(alert.event).toBe('Wind');
      expect(alert.severity).toBe('extreme');
      expect(alert.severityLabel).toBe('Extreme');
      expect(alert.description).toBe('Rajadas até 120 km/h, podendo atingir 140 km/h nos locais mais expostos.');
      expect(alert.zones).toEqual(['LSB']);
      expect(alert.areaDesc).toBe('Lisboa');
      expect(alert.url).toBe('https://www.ipma.pt/pt/otempo/prev-sam/?p=LSB');
      expect(alert.severityInferred).toBe(false);
    });

    it('takes timestamps from startTime and endTime; sentTs is unknown', () => {
      const [alert] = adapter.parseAlerts(capturedWind());
      expect(alert.onsetTs).toBe(parseTimestamp('2026-11-11 12:00:00'));
      expect(alert.endsTs).toBe(parseTimestamp('2026-11-11 21:00:00'));
      expect(alert.sentTs).toBe(0);
    });

    it('maps each awareness colour to a severity', () => {
      const cases: [string, string][] = [
        ['green', 'minor'],
        ['yellow', 'moderate'],
        ['orange', 'severe'],
        ['red', 'extreme'],
      ];
      for (const [colour, severity] of cases) {
        const [alert] = adapter.parseAlerts(capturedWind({ awarenessLevelID: colour }));
        expect(alert.severity).toBe(severity);
      }
    });

    it('marks an unknown colour as unknown severity and inferred', () => {
      const [alert] = adapter.parseAlerts(capturedWind({ awarenessLevelID: 'purple' }));
      expect(alert.severity).toBe('unknown');
      expect(alert.severityInferred).toBe(true);
    });

    it('translates known types and passes unknown types through', () => {
      expect(adapter.parseAlerts(capturedWind({ awarenessTypeName: 'Agitação marítima' }))[0].event)
        .toBe('Coastal swell');
      expect(adapter.parseAlerts(capturedWind({ awarenessTypeName: 'Granizo' }))[0].event)
        .toBe('Granizo');
    });

    it('returns nothing when the warning fields are empty', () => {
      expect(adapter.parseAlerts(capturedWind({ awarenessTypeName: '' }))).toEqual([]);
      expect(adapter.parseAlerts(capturedWind({ awarenessLevelID: '' }))).toEqual([]);
    });
  });

  describe('list form (warnings array)', () => {
    const item = (over: Record<string, unknown>): Record<string, unknown> => ({
      text: '',
      awarenessTypeName: 'Vento',
      idAreaAviso: 'LSB',
      startTime: '2026-11-11T12:00:00',
      awarenessLevelID: 'red',
      endTime: '2026-11-11T21:00:00',
      ...over,
    });

    it('detects a warnings list of IPMA items', () => {
      expect(adapter.canHandle({ warnings: [item({})] })).toBe(true);
    });

    it('returns one alert per non-green warning, in order', () => {
      const alerts = adapter.parseAlerts({
        warnings: [
          item({ awarenessTypeName: 'Vento', awarenessLevelID: 'red' }),
          item({ awarenessTypeName: 'Chuva', awarenessLevelID: 'orange' }),
          item({ awarenessTypeName: 'Nevoeiro', awarenessLevelID: 'green' }),
          item({ awarenessTypeName: 'Trovoada', awarenessLevelID: 'yellow' }),
        ],
      });
      expect(alerts.map(a => a.event)).toEqual(['Wind', 'Rain', 'Thunderstorm']);
      expect(alerts.map(a => a.severity)).toEqual(['extreme', 'severe', 'moderate']);
    });

    it('gives each alert its own id', () => {
      const alerts = adapter.parseAlerts({
        warnings: [
          item({ awarenessTypeName: 'Agitação Marítima', awarenessLevelID: 'orange' }),
          item({ awarenessTypeName: 'Agitação Marítima', awarenessLevelID: 'yellow', startTime: '2026-11-10T07:19:00' }),
        ],
      });
      expect(new Set(alerts.map(a => a.id)).size).toBe(2);
    });

    it('returns nothing when every warning is green', () => {
      expect(adapter.parseAlerts({ warnings: [item({ awarenessLevelID: 'green' })] })).toEqual([]);
    });

    it('does not claim a BoM-shaped warnings array', () => {
      const bom = { warnings: [{ warning_group_type: 'major', issue_time: '2026-03-06T10:00:00Z' }] };
      expect(adapter.canHandle(bom)).toBe(false);
    });
  });

  describe('icons', () => {
    it('gives each IPMA type a specific icon, not the generic fallback', () => {
      const cases: [string, string][] = [
        ['Vento', 'mdi:weather-windy'],
        ['Chuva', 'mdi:weather-pouring'],
        ['Precipitação', 'mdi:weather-pouring'],
        ['Neve', 'mdi:weather-snowy-heavy'],
        ['Trovoada', 'mdi:weather-lightning'],
        ['Nevoeiro', 'mdi:weather-fog'],
        ['Calor', 'mdi:weather-sunny-alert'],
        ['Frio', 'mdi:thermometer-low'],
        ['Agitação Marítima', 'mdi:waves'],
        ['Tempo Quente', 'mdi:weather-sunny-alert'],
        ['Tempo Frio', 'mdi:thermometer-low'],
      ];
      for (const [type, icon] of cases) {
        const [alert] = adapter.parseAlerts({ warnings: [{ ...capturedWind(), awarenessTypeName: type }] });
        expect(getWeatherIcon(alert.iconHint || alert.event)).toBe(icon);
      }
    });
  });

  describe('registry', () => {
    it('is selected by explicit provider for an idle sensor', () => {
      expect(getAdapter('ipma', { friendly_name: 'Oeiras Weather Alert' }).provider).toBe('ipma');
    });

    it('is auto-detected from a warnings list', () => {
      expect(getAdapter(undefined, { warnings: [{ awarenessLevelID: 'red', awarenessTypeName: 'Vento', idAreaAviso: 'LSB' }] }).provider).toBe('ipma');
    });

    it('is auto-detected from the captured payload', () => {
      expect(getAdapter(undefined, capturedWind()).provider).toBe('ipma');
    });
  });
});
