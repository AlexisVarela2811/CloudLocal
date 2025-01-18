import React from 'react';
import useFileOperations from '../hooks/useFileOperations';
import { FaFile, FaDownload, FaTrash } from 'react-icons/fa';
import { motion } from 'framer-motion';

const FileManager: React.FC = () => {
    const {
        files,
        error,
        handleFileDelete,
        handleFileDownload
    } = useFileOperations();

    return (
        <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="bg-white rounded-lg shadow-md p-6"
        >
            {error && <div className="text-red-600 text-center mb-4">{error}</div>}
            <div className="bg-white rounded-lg shadow-md p-6">
                {error && <div className="text-red-600 text-center mb-4">{error}</div>}
                {files.length === 0 ? (
                    <div className="text-center text-gray-500">
                        <p>No hay archivos subidos.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead>
                                <tr className="bg-[#090005]">
                                    <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">Nombre</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-white uppercase tracking-wider">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {files.map((file, index) => (
                                    <motion.tr 
                                        key={file}
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, delay: index * 0.1 }}
                                        className="hover:bg-gray-50"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <FaFile className="text-[#090005] mr-3" />
                                                <span className="text-sm font-medium text-[#090005]">{file}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleFileDownload(file)}
                                                className="text-[#090005] hover:text-[#090005] mr-4 transition-colors duration-200"
                                            >
                                                <FaDownload />
                                            </button>
                                            <button
                                                onClick={() => handleFileDelete(file)}
                                                className="text-[#090005] hover:text-[#090005] transition-colors duration-200"
                                            >
                                                <FaTrash />
                                            </button>
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default FileManager;
