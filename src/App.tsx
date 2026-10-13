import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomeRoute from './pages/HomeRoute';
import HowItWorksPage from './pages/HowItWorksPage';
import SecurityPage from './pages/SecurityPage';
import FAQPage from './pages/FAQPage';
import ContactPage from './pages/ContactPage';
import NotFoundPage from './pages/NotFoundPage';
import SearchTripPage from './pages/SearchTripPage';
import OfferTripPage from './pages/OfferTripPage';
import MyTripsPage from './pages/MyTripsPage';
import CarRegistrationPage from './pages/CarRegistrationPage';
import SupabaseTestPage from './pages/SupabaseTestPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import TripDetailPage from './pages/TripDetailPage';
import MyProfilePage from './pages/MyProfilePage';
import PublicProfilePage from './pages/PublicProfilePage';
import MobilityAnalyticsPage from './pages/MobilityAnalyticsPage';
import DemandDashboardPage from './pages/DemandDashboardPage';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/como-funciona" element={<HowItWorksPage />} />
        <Route path="/seguridad" element={<SecurityPage />} />
        <Route path="/preguntas-frecuentes" element={<FAQPage />} />
        <Route path="/contacto" element={<ContactPage />} />

        {/* Rutas privadas: requieren sesión. Sin sesión -> /login (con destino). */}
        <Route element={<ProtectedRoute />}>
          <Route path="/buscar-viaje" element={<SearchTripPage />} />
          <Route path="/ofrecer-viaje" element={<OfferTripPage />} />
          <Route path="/mis-viajes" element={<MyTripsPage />} />
          <Route path="/mis-viajes/:tripId" element={<TripDetailPage />} />
          <Route path="/perfil" element={<MyProfilePage />} />
          <Route path="/registrar-auto" element={<CarRegistrationPage />} />
        </Route>

        {/* Públicas (accesibles sin sesión) */}
        <Route path="/perfil/:userId" element={<PublicProfilePage />} />
        <Route path="/analitica" element={<MobilityAnalyticsPage />} />
        <Route path="/analitica/demanda" element={<DemandDashboardPage />} />
        <Route path="/test-supabase" element={<SupabaseTestPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
