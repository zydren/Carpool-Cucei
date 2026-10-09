import Navbar from '../components/Navbar';
import HeroSection from '../components/HeroSections';
import DashboardHome from '../components/DashboardHome';
import HowItWorks from '../components/HowItWorks';
import Benefits from '../components/Benefits';
import Footer from '../components/Footer';

const HomePage = () => {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <HeroSection />
      <DashboardHome />
      <HowItWorks />
      <Benefits />
      <Footer />
    </div>
  );
};

export default HomePage;
