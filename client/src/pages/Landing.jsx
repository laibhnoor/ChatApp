import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Landing.css';

const Landing = () => {
  const { user } = useAuth();

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-content">
          <p className="hero-tag">Real-time messaging</p>
          <h1 className="hero-title">
            Chat with anyone,<br />anywhere.
          </h1>
          <p className="hero-subtitle">
            Simple, fast, secure messaging. No clutter, just conversation.
          </p>
          <div className="hero-buttons">
            {user ? (
              <Link to="/chat" className="btn-main">
                Open Chat →
              </Link>
            ) : (
              <>
                <Link to="/signup" className="btn-main">
                  Get Started →
                </Link>
                <Link to="/login" className="btn-secondary">
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="features">
        <div className="features-grid">
          <div className="feature">
            <span className="feature-num">01</span>
            <h3>Secure</h3>
            <p>JWT authentication and encrypted connections keep your data safe.</p>
          </div>
          <div className="feature">
            <span className="feature-num">02</span>
            <h3>Real-time</h3>
            <p>Instant message delivery with WebSocket technology.</p>
          </div>
          <div className="feature">
            <span className="feature-num">03</span>
            <h3>Simple</h3>
            <p>Clean interface. No ads, no distractions. Just chat.</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <p>Built with MERN Stack</p>
      </footer>
    </div>
  );
};

export default Landing;
