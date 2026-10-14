'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api as globalApi } from '@/lib/api';
import { ACCEPTED_PHOTO_TYPES, isUploadedPhoto, prepareForUpload } from '@/lib/photo';
import type { Gender, Person, PersonInput } from '@/lib/types';
import DateInput from './DateInput';
import { useI18n } from './I18nProvider';
import Icon from './Icon';
import MoreMenu from './MoreMenu';
import PhotoEditor from './PhotoEditor';
import { useCurrentTree } from './TreeProvider';

// Whether the server has photo storage set up; asked once per page load.
let photoUploadsEnabled: Promise<boolean> | undefined;
function usePhotoUploads(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    photoUploadsEnabled ??= globalApi
      .features()
      .then((f) => f.photoUploads)
      .catch(() => {
        photoUploadsEnabled = undefined; // ask again next time
        return false;
      });
    let cancelled = false;
    photoUploadsEnabled.then((value) => !cancelled && setEnabled(value));
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

const TEXT_FIELDS = ['firstName', 'lastName', 'birthDate', 'deathDate', 'birthPlace', 'address', 'photoUrl', 'bio'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
type FormState = Record<TextField, string> & { gender: Gender };

interface Props {
  person?: Person; // edit mode when provided
  onSaved: (person: Person) => void;
  onCancel: () => void;
}

export default function PersonForm({ person, onSaved, onCancel }: Props) {
  const { treeApi: api } = useCurrentTree();
  const { t, locale, errorMessage } = useI18n();
  const [form, setForm] = useState<FormState>(() => ({
    firstName: person?.firstName ?? '',
    lastName: person?.lastName ?? '',
    gender: person?.gender ?? 'unknown',
    birthDate: person?.birthDate ?? '',
    deathDate: person?.deathDate ?? '',
    birthPlace: person?.birthPlace ?? '',
    address: person?.address ?? '',
    photoUrl: person?.photoUrl ?? '',
    bio: person?.bio ?? '',
  }));
  const [saving, setSaving] = useState<false | 'uploading' | 'saving'>(false);
  const [error, setError] = useState<string | null>(null);
  const photoUploads = usePhotoUploads();
  // A chosen file is only uploaded on Save, so cancelling leaves nothing behind.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // If saving fails after the upload, a retry reuses the uploaded photo.
  const uploaded = useRef<{ file: File; url: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [editingPhoto, setEditingPhoto] = useState<File | null>(null);
  // Phones and tablets get "Take photo" (rear camera) besides choosing a file.
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia('(pointer: coarse)').matches), []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const set = (field: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // A photo just taken or chosen opens in the editor (crop, rotate, straighten) before it's used.
  function choosePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires onChange
    if (!file) return;
    // The camera may report a generic type; the editor checks the picture itself.
    if (file.type && !file.type.startsWith('image/')) {
      setError(t('form.photoNotImage'));
      return;
    }
    setError(null);
    setEditingPhoto(file);
  }

  const photoEdited = (photo: Blob) => {
    setEditingPhoto(null);
    setPhotoFile(new File([photo], photo.type === 'image/webp' ? 'photo.webp' : 'photo.jpg', { type: photo.type }));
  };
  const photoUnreadable = useCallback(() => {
    setEditingPhoto(null);
    setError(t('form.photoNotImage'));
  }, [t]);

  function removePhoto() {
    setPhotoFile(null);
    setForm((f) => ({ ...f, photoUrl: '' }));
  }

  async function uploadPhoto(file: File): Promise<string> {
    if (uploaded.current?.file === file) return uploaded.current.url;
    setSaving('uploading');
    let image: Blob;
    try {
      image = await prepareForUpload(file);
    } catch {
      throw new Error(t('form.photoNotImage'));
    }
    try {
      const { url } = await api.uploadPhoto(image);
      uploaded.current = { file, url };
      return url;
    } catch (err) {
      throw new Error(t('form.photoUploadFailed', { error: (err as Error).message }));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving('saving');
    setError(null);
    try {
      const values = { ...form, photoUrl: photoFile ? await uploadPhoto(photoFile) : form.photoUrl };
      const fields: Record<string, string | null> = { gender: form.gender };
      for (const field of TEXT_FIELDS) {
        const value = values[field].trim();
        // Blank fields are omitted on create and cleared (null) on edit.
        if (value) fields[field] = value;
        else if (person) fields[field] = null;
      }
      const payload = fields as PersonInput;
      setSaving('saving');
      const saved = person ? await api.updatePerson(person.id, payload) : await api.createPerson(payload);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const photoSrc = photoPreview ?? (form.photoUrl.trim() || null);

  const firstNameField = (
    <label key="first">
      {t('form.firstName')}
      <input value={form.firstName} onChange={set('firstName')} required autoFocus />
    </label>
  );
  const lastNameField = (
    <label key="last">
      {t('form.lastName')}
      <input value={form.lastName} onChange={set('lastName')} />
    </label>
  );

  return (
    <form className="form" onSubmit={submit}>
      <h2>{person ? t('form.titleEdit') : t('form.titleAdd')}</h2>
      {/* Vietnamese names are written family name first (Họ, then Tên). */}
      <div className="row">{locale === 'vi' ? [lastNameField, firstNameField] : [firstNameField, lastNameField]}</div>
      <label>
        {t('form.gender')}
        <GenderSelect value={form.gender} onChange={set('gender')} />
      </label>
      <div className="row">
        <DateInput
          label={t('form.born')}
          kind="birth"
          value={form.birthDate}
          onChange={(v) => set('birthDate')({ target: { value: v } })}
        />
        <DateInput
          label={t('form.died')}
          kind="death"
          value={form.deathDate}
          onChange={(v) => set('deathDate')({ target: { value: v } })}
        />
      </div>
      <label>
        {t('form.birthplace')}
        <input value={form.birthPlace} onChange={set('birthPlace')} />
      </label>
      <label>
        {t('form.address')}
        <input value={form.address} onChange={set('address')} autoComplete="off" />
      </label>
      {photoUploads ? (
        <div className="photo-field">
          {t('form.photo')}
          <div className="photo-row">
            {photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoSrc} alt="" className="avatar" />
            ) : (
              <span className="avatar empty" />
            )}
            <input ref={fileInput} type="file" accept={ACCEPTED_PHOTO_TYPES} onChange={choosePhoto} />
            {/* capture opens the rear camera: mostly old printed photos and people in front of you. */}
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
            {touch ? (
              <MoreMenu
                trigger={{ label: photoSrc ? t('form.photoChange') : t('form.photoUpload'), icon: 'camera' }}
                items={[
                  { label: t('form.photoTake'), icon: 'camera', onSelect: () => cameraInput.current?.click() },
                  { label: t('form.photoChoose'), icon: 'image', onSelect: () => fileInput.current?.click() },
                ]}
              />
            ) : (
              <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={!!saving}>
                <Icon name="image" />
                {photoSrc ? t('form.photoChange') : t('form.photoUpload')}
              </button>
            )}
            {photoSrc && (
              <button type="button" className="btn danger" onClick={removePhoto} disabled={!!saving}>
                {t('form.photoRemove')}
              </button>
            )}
          </div>
          <input
            type="url"
            aria-label={t('form.photoUrl')}
            // An uploaded photo's internal path isn't a link worth showing.
            value={photoFile || isUploadedPhoto(form.photoUrl) ? '' : form.photoUrl}
            onChange={(e) => {
              setPhotoFile(null);
              set('photoUrl')(e);
            }}
            placeholder={`${t('form.photoLinkInstead')}: https://…`}
          />
        </div>
      ) : (
        <label>
          {t('form.photoUrl')}
          <input type="url" value={form.photoUrl} onChange={set('photoUrl')} placeholder="https://…" />
        </label>
      )}
      <label>
        {t('form.bio')}
        <textarea rows={4} value={form.bio} onChange={set('bio')} />
      </label>
      {editingPhoto && (
        <PhotoEditor
          file={editingPhoto}
          onDone={photoEdited}
          onCancel={() => setEditingPhoto(null)}
          onError={photoUnreadable}
        />
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!!saving}>
          {saving === 'uploading' ? t('form.photoUploading') : saving ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={!!saving}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

export function GenderSelect({ value, onChange }: { value: Gender; onChange: (e: { target: { value: string } }) => void }) {
  const { formatGender } = useI18n();
  return (
    <select value={value} onChange={onChange}>
      {(['unknown', 'female', 'male', 'other'] as const).map((g) => (
        <option key={g} value={g}>
          {formatGender(g)}
        </option>
      ))}
    </select>
  );
}
