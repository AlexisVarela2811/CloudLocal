import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { api } from '../api/api';
import { FaCloudUploadAlt } from 'react-icons/fa';

interface FileUploadProps {
    onUploadComplete: () => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onUploadComplete }) => {
    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        try {
            for (const file of acceptedFiles) {
                await api.uploadFile(file);
            }
            onUploadComplete();
        } catch (error) {
            console.error('Error uploading files:', error);
        }
    }, [onUploadComplete]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        multiple: true
    });

    return (
        <div
            {...getRootProps()}
            className={`w-full p-8 border-2 border-dashed rounded-lg border-[#090005] transition-colors duration-200 ease-in-out cursor-pointer`}
        >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center text-center">
                <FaCloudUploadAlt className="text-5xl mb-4 text-[#090005]" />
                {isDragActive ? (
                    <p className="text-[#090005] text-lg font-semibold">Suelta tus archivos aqui...</p>
                ) : (
                    <>
                        <p className="text-[#090005] text-lg font-semibold">Arrastra y suelta tus archivos aqui, o haz clic para seleccionar archivos</p>
                        <p className="text-sm text-[#090005] mt-2">
                            Tipos de archivos admitidos: Todos los tipos de archivos
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default FileUpload;
