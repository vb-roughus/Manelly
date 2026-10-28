import { describe, expect, it } from 'vitest';
import { initialChoices, rememberedChoices } from './convertChoices';

const everything = { folders: ['D:\\Filme', 'E:\\UHD'], work: true, schedule: true };

describe('conversion dialog choices', () => {
  it('starts next to the original, in the work folder and after the schedule when nothing is remembered', () => {
    expect(initialChoices({}, everything)).toEqual({ mode: 'alongside', folder: 'D:\\Filme', work: true, scheduled: true });
    expect(initialChoices({}, { folders: [], work: false, schedule: false })).toEqual({ mode: 'alongside', folder: null, work: false, scheduled: false });
  });

  it('takes the last choices as far as they fit', () => {
    expect(initialChoices({ mode: 'folder', folder: 'e:\\uhd\\', work: false, scheduled: false }, everything)).toEqual({
      mode: 'folder',
      folder: 'E:\\UHD',
      work: false,
      scheduled: false,
    });
    // A library folder that is gone, no folders at all, no work folder or schedule any more.
    expect(initialChoices({ mode: 'folder', folder: 'F:\\Alt' }, everything)).toMatchObject({ mode: 'folder', folder: 'D:\\Filme' });
    expect(initialChoices({ mode: 'folder', folder: 'E:\\UHD' }, { folders: [], work: false, schedule: false })).toMatchObject({ mode: 'alongside', folder: null });
    expect(initialChoices({ work: true, scheduled: true }, { ...everything, work: false, schedule: false })).toMatchObject({ work: false, scheduled: false });
  });

  it('remembers what was chosen, and keeps what the dialog could not offer', () => {
    expect(rememberedChoices({ mode: 'replace', folder: 'D:\\Filme', work: false, scheduled: false }, { folder: 'E:\\UHD' }, everything)).toEqual({
      mode: 'replace',
      folder: 'E:\\UHD',
      work: false,
      scheduled: false,
    });
    // Without a work folder or schedule this time, the earlier wish stays.
    expect(rememberedChoices({ mode: 'folder', folder: 'D:\\Filme', work: false, scheduled: false }, { work: true }, { ...everything, work: false, schedule: false })).toEqual({
      mode: 'folder',
      folder: 'D:\\Filme',
      work: true,
      scheduled: true,
    });
  });
});
