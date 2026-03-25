/**
 * Direct client-side file upload using pre-signed URLs
 * Flow: Request pre-signed URL → Upload to Supabase → Return public URL
 */

const BACKEND_URL = import.meta.env.DEV
    ? "http://localhost:3001"
    : "https://safepost-backup.onrender.com";

export class PresignedUploadService {
    /**
     * Get a pre-signed URL from the backend
     */
    static async getPresignedUrl(file) {
        try {
            console.log('📤 [PRESIGNED-CLIENT] Requesting signed URL for:', file.name);
            console.log('   File size:', file.size, 'bytes');
            console.log('   MIME type:', file.type);

            const response = await fetch(`${BACKEND_URL}/api/upload/presigned`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    fileSize: file.size,
                    mimeType: file.type || 'application/octet-stream'
                })
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('❌ [PRESIGNED-CLIENT] Backend error:', error);
                throw new Error(error.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ [PRESIGNED-CLIENT] Got signed URL');
            console.log('   Expires in:', data.expiresIn, 'seconds');
            console.log('   Path:', data.filePath);

            return data;
        } catch (err) {
            console.error('🔥 [PRESIGNED-CLIENT] Failed to get signed URL:', err.message);
            throw err;
        }
    }

    /**
     * Upload file directly to Supabase Storage using pre-signed URL
     */
    static async uploadToStorage(file, signedUrl, filePath) {
        try {
            console.log('📤 [UPLOAD-STORAGE] Starting direct upload to Supabase');
            console.log('   File:', file.name, `(${file.size} bytes)`);
            console.log('   Target path:', filePath);

            const response = await fetch(signedUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type || 'application/octet-stream'
                }
            });

            if (!response.ok) {
                const text = await response.text();
                console.error('❌ [UPLOAD-STORAGE] Upload failed:', response.status);
                console.error('   Response:', text.substring(0, 200));
                throw new Error(`Upload failed: HTTP ${response.status}`);
            }

            console.log('✅ [UPLOAD-STORAGE] Upload successful');
            console.log('   File stored at:', filePath);

            return {
                success: true,
                filePath: filePath,
                size: file.size,
                type: file.type
            };
        } catch (err) {
            console.error('🔥 [UPLOAD-STORAGE] Upload error:', err.message);
            throw err;
        }
    }

    /**
     * Main upload flow: Get pre-signed URL → Upload to Storage
     * Returns the file path for database storage
     */
    static async uploadFile(file) {
        try {
            console.log('🚀 [UPLOAD-FLOW] Starting full upload flow');

            // Step 1: Get pre-signed URL from backend
            const presigned = await this.getPresignedUrl(file);

            // Step 2: Upload directly to Supabase
            const result = await this.uploadToStorage(
                file,
                presigned.signedUrl,
                presigned.filePath
            );

            console.log('🎯 [UPLOAD-FLOW] Complete:', result.filePath);
            return result;
        } catch (err) {
            console.error('🔥 [UPLOAD-FLOW] Failed:', err.message);
            throw err;
        }
    }

    /**
     * Validate file before upload
     */
    static validateFile(file, maxSizeMB = 50) {
        const maxBytes = maxSizeMB * 1024 * 1024;

        if (!file) {
            throw new Error('No file selected');
        }

        if (file.size === 0) {
            throw new Error('File is empty');
        }

        if (file.size > maxBytes) {
            throw new Error(`File exceeds ${maxSizeMB}MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        }

        // Whitelist common media types
        const ALLOWED_TYPES = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'video/mp4',
            'video/quicktime',
            'video/x-msvideo',
            'application/octet-stream' // fallback
        ];

        if (file.type && !ALLOWED_TYPES.includes(file.type)) {
            console.warn(`⚠️ Unsupported MIME type: ${file.type}, proceeding anyway`);
        }

        return true;
    }
}
