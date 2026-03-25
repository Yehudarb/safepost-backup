import { useState, useCallback } from 'react';
import { PresignedUploadService } from '@/services/presignedUpload';

/**
 * Hook for managing media uploads with pre-signed URLs
 * Handles validation, upload progress, errors
 */
export function useMediaUpload() {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [uploadedFile, setUploadedFile] = useState(null);

    const uploadFile = useCallback(async (file) => {
        try {
            console.log('🎯 [HOOK] Starting upload for:', file.name);
            setError(null);
            setProgress(0);
            setUploading(true);

            // Validate
            PresignedUploadService.validateFile(file);
            console.log('✅ [HOOK] File validation passed');

            // Upload
            setProgress(25);
            const result = await PresignedUploadService.uploadFile(file);

            setProgress(100);
            setUploadedFile(result);
            console.log('✅ [HOOK] Upload complete:', result);

            return result;
        } catch (err) {
            console.error('❌ [HOOK] Upload failed:', err.message);
            setError(err.message);
            setProgress(0);
            throw err;
        } finally {
            setUploading(false);
        }
    }, []);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const reset = useCallback(() => {
        setUploading(false);
        setProgress(0);
        setError(null);
        setUploadedFile(null);
    }, []);

    return {
        uploadFile,
        uploading,
        progress,
        error,
        uploadedFile,
        clearError,
        reset
    };
}
