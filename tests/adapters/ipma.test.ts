import { describe, it, expect } from 'vitest';
import { IpmaAdapter } from '../../src/adapters/ipma';
import { getAdapter } from '../../src/adapters';
import { parseTimestamp } from '../../src/utils';

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

  describe('registry', () => {
    it('is selected by explicit provider for an idle sensor', () => {
      expect(getAdapter('ipma', { friendly_name: 'Oeiras Weather Alert' }).provider).toBe('ipma');
    });

    it('is auto-detected from the captured payload', () => {
      expect(getAdapter(undefined, capturedWind()).provider).toBe('ipma');
    });
  });
});
