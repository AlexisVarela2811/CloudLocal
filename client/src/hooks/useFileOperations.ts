import { useState, useEffect } from 'react';
import { api } from '../api/api';

const useFileOperations = () => {
    const [files, setFiles] = useState<string[]>([]);
    const [fileToUpload, setFileToUpload] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch files
    const fetchFiles = async () => {
        try {
            const fileList = await api.getAllFiles();
            setFiles(fileList);
            console.log('Files after setting:', fileList);
        } catch (err) {
            setError('Error al cargar los archivos');
        }
    };

    // Upload file
    const handleFileUpload = async () => {
        if (fileToUpload) {
            setIsUploading(true);
            try {
                const uploadedFile = await api.uploadFile(fileToUpload);
                setFiles((prevFiles) => [...prevFiles, uploadedFile.filename]);
            } catch (err) {
                setError('Error al subir el archivo');
            } finally {
                setIsUploading(false);
                setFileToUpload(null);
            }
        }
    };

    // Delete file
    const handleFileDelete = async (filename: string) => {
        try {
            await api.deleteFile(filename);
            setFiles((prevFiles) => prevFiles.filter((file) => file !== filename));
        } catch (err) {
            setError('Error al borrar el archivo');
        }
    };

    // Download file
    const handleFileDownload = async (filename: string) => {
        try {
            const fileBlob = await api.downloadFile(filename);
            const url = window.URL.createObjectURL(fileBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename; // Asignar el nombre del archivo
            a.click();
        } catch (err) {
            setError('Error al descargar el archivo');
        }
    };

    // Fetch files on mount
    useEffect(() => {
        fetchFiles();
    }, []);

    return {
        files,
        isUploading,
        error,
        setFileToUpload,
        handleFileUpload,
        handleFileDelete,
        handleFileDownload,
    };
};

export default useFileOperations;
