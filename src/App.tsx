import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import HowItWorksPage from './pages/HowItWorksPage';
import SecurityPage from './pages/SecurityPage';
import FAQPage from './pages/FAQPage';
import ContactPage from './pages/ContactPage';
import NotFoundPage from './pages/NotFoundPage';
import SearchTripPage from './pages/SearchTripPage';
import OfferTripPage from './pages/OfferTripPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/como-funciona" element={<HowItWorksPage />} />
        <Route path="/seguridad" element={<SecurityPage />} />
        <Route path="/preguntas-frecuentes" element={<FAQPage />} />
        <Route path="/contacto" element={<ContactPage />} />
        <Route path="/buscar-viaje" element={<SearchTripPage />} />
        <Route path="/ofrecer-viaje" element={<OfferTripPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
