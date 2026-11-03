import { useEffect, useState } from 'react';
import { api as globalApi } from '@/lib/api';

// Whether the server has photo storage set up; asked once per page load.
let photoUploadsEnabled: Promise<boolean> | undefined;
export function usePhotoUploads(): boolean {
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
