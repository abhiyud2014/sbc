// @vitest-environment node
/**
 * Regression tests for the participant "My Classes" attendance roll-up.
 *
 * Zoom splits one student across roster rows: joins WITH an email are keyed by
 * email, joins WITHOUT an email are keyed by display name. My Classes used to
 * trust a single row, so a session attended under the other row showed as
 * "Absent" even though the admin attendance audit saw the join.
 */
import { describe, expect, it } from 'vitest';
import { attendanceFromParticipants, buildStudentAttendance } from '../../server/app.js';

const meeting = (overrides = {}) => ({
  id: 81060594579,
  uuid: 'u1',
  topic: 'Point of intrest',
  start_time: '2026-10-23T14:10:57Z',
  minutes: 30,
  ...overrides,
});

const rosterOf = (students) => ({ students });

describe('buildStudentAttendance', () => {
  it('unions the email-keyed and name-keyed rows for the same student', () => {
    const roster = rosterOf([
      { email: 'amulya@example.com', name: 'Amulya Ratna Swain', meetings: [meeting({ uuid: 'with-email' })] },
      { email: '', name: 'Amulya Ratna Swain', meetings: [meeting({ uuid: 'no-email', minutes: 12 })] },
      { email: 'someone@example.com', name: 'Someone Else', meetings: [meeting({ uuid: 'not-me' })] },
    ]);

    const { byUuid } = buildStudentAttendance(roster, {
      email: 'amulya@example.com',
      name: 'Amulya Ratna Swain',
    });

    expect(byUuid.has('with-email')).toBe(true);
    expect(byUuid.has('no-email')).toBe(true);
    expect(byUuid.has('not-me')).toBe(false);
    expect(byUuid.get('no-email')).toBe(12);
  });

  it('falls back to the name when the Zoom email differs from the LMS email', () => {
    const roster = rosterOf([
      { email: 'zoom-account@example.com', name: 'Roman Sahoo', meetings: [meeting({ uuid: 'via-name' })] },
    ]);

    const { byUuid } = buildStudentAttendance(roster, {
      email: 'sahooroman696@gmail.com',
      name: 'Roman Sahoo',
    });

    expect(byUuid.has('via-name')).toBe(true);
  });

  it('matches case and surrounding whitespace', () => {
    const roster = rosterOf([
      { email: '  ROMAN@Example.com ', name: ' roman sahoo ', meetings: [meeting({ uuid: 'case' })] },
    ]);

    const { byUuid } = buildStudentAttendance(roster, {
      email: 'roman@example.com',
      name: 'Roman Sahoo',
    });

    expect(byUuid.has('case')).toBe(true);
  });

  it('adds minutes when the same instance appears under both rows', () => {
    const roster = rosterOf([
      { email: 'a@example.com', name: 'A', meetings: [meeting({ uuid: 'same', minutes: 10 })] },
      { email: '', name: 'A', meetings: [meeting({ uuid: 'same', minutes: 5 })] },
    ]);

    const { byUuid } = buildStudentAttendance(roster, { email: 'a@example.com', name: 'A' });
    expect(byUuid.get('same')).toBe(15);
  });

  it('does not credit other instances of the same recurring meeting id', () => {
    const roster = rosterOf([
      {
        email: 'a@example.com',
        name: 'A',
        meetings: [
          meeting({ id: 81060594579, uuid: 'attended-instance', start_time: '2026-10-23T14:10:57Z' }),
        ],
      },
    ]);

    const { byUuid, byInstance } = buildStudentAttendance(roster, { email: 'a@example.com', name: 'A' });

    expect(byUuid.has('attended-instance')).toBe(true);
    expect(byInstance.has('81060594579|2026-10-23T14:10:57Z')).toBe(true);
    // A different instance of the same Personal Meeting Room is not credited.
    expect(byUuid.has('missed-instance')).toBe(false);
    expect(byInstance.has('81060594579|2026-10-23T11:51:44Z')).toBe(false);
  });
});

describe('attendanceFromParticipants', () => {
  const student = { email: 'amulya@example.com', name: 'Amulya Ratna Swain' };
  const instance = (overrides = {}) => ({
    id: 81060594579,
    uuid: 'u1',
    start_time: '2026-10-24T14:23:19Z',
    ...overrides,
  });

  it('credits a join recorded with an email and another recorded by name', () => {
    const rows = new Map([
      [
        'u1',
        [
          { name: 'Amulya Ratna Swain', user_email: '', duration: 600 },
          { name: 'Amulya', user_email: 'amulya@example.com', duration: 300 },
        ],
      ],
    ]);
    const { byUuid, byInstance, pending } = attendanceFromParticipants([instance()], student, rows);

    expect(byUuid.get('u1')).toBe(15);
    expect(byInstance.get('81060594579|2026-10-24T14:23:19Z')).toBe(15);
    expect(pending).toEqual([]);
  });

  it('marks an instance pending when its participant rows were never fetched', () => {
    const { byUuid, pending } = attendanceFromParticipants([instance()], student, new Map());

    expect(byUuid.has('u1')).toBe(false);
    expect(pending).toEqual(['u1']);
  });

  it('treats a fetched-but-empty participant list as absent, not pending', () => {
    const rows = new Map([['u1', []]]);
    const { byUuid, pending } = attendanceFromParticipants([instance()], student, rows);

    expect(byUuid.has('u1')).toBe(false);
    expect(pending).toEqual([]);
  });

  it('does not credit another instance that shares the meeting id', () => {
    const rows = new Map([
      ['u1', [{ name: 'Amulya Ratna Swain', duration: 2640 }]],
      ['u2', []],
    ]);
    const { byUuid, pending } = attendanceFromParticipants(
      [instance(), instance({ uuid: 'u2', start_time: '2026-10-23T14:10:57Z' })],
      student,
      rows
    );

    expect(byUuid.get('u1')).toBe(44);
    expect(byUuid.has('u2')).toBe(false);
    expect(pending).toEqual([]);
  });
});
