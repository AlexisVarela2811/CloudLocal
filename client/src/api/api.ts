import axios from 'axios';

export interface FileInfo {
    filename: string;
    path: string;
}

const API_BASE_URL = 'http://192.168.1.6:5000/api';

    export const api = {
        // Obtener todos los archivos
        getAllFiles: async (): Promise<string[]> => {
            const response = await axios.get(`${API_BASE_URL}/files/list`);
            return response.data.files; // El backend devuelve un array de nombres de archivo
        },

    // Subir archivo
    uploadFile: async (file: File): Promise<FileInfo> => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await axios.post(`${API_BASE_URL}/files/upload`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data.file; // El backend devuelve un objeto con la info del archivo
    },

    // Descargar archivo
    downloadFile: async (filename: string): Promise<Blob> => {
        const response = await axios.get(`${API_BASE_URL}/files/download/${encodeURIComponent(filename)}`, {
            responseType: 'blob',
            headers: {
                'Content-Type': 'application/octet-stream',
            },
        });
        return response.data; // El backend devuelve un stream del archivo
    },

    // Eliminar archivo
    deleteFile: async (filename: string): Promise<void> => {
        await axios.delete(`${API_BASE_URL}/files/delete/${encodeURIComponent(filename)}`);
    },
};
