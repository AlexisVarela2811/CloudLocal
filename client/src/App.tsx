import { useState } from 'react';
import { FileUpload } from './components/FileUpload';
import FileManager from './components/FileManager';
import { motion } from 'framer-motion';

function App() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUploadComplete = () => {
    setRefreshKey(prevKey => prevKey + 1);
  };

  return (
    <div className="min-h-screen bg-[#090005] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="container max-w-4xl bg-white bg-opacity-90 backdrop-blur-lg rounded-2xl shadow-2xl p-8"
      >
        <h1 className="text-4xl font-bold text-[#090005] mb-8 text-center">Gestor de Archivos</h1>
        
        <div className="space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-[#090005] mb-4">Subir Archivos</h2>
            <FileUpload onUploadComplete={handleUploadComplete} />
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#090005] mb-4">Tus Archivos</h2>
            <FileManager key={refreshKey} />
          </section>
        </div>
      </motion.div>
    </div>
  );
}

export default App;

