import Navbar from '../components/Navbar';
import HeroSection from '../components/HeroSections';
import HowItWorks from '../components/HowItWorks';
import Benefits from '../components/Benefits';
import Footer from '../components/Footer';

const HomePage = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <HowItWorks />
      <Benefits />
      <Footer />
    </div>
  );
};

export default HomePage;
