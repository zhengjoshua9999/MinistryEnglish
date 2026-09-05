import { NavLink, Route, Routes } from 'react-router-dom'
import UploadPage from './pages/UploadPage'
import PracticePage from './pages/PracticePage'
import VocabPage from './pages/VocabPage'
import StatsPage from './pages/StatsPage'
import ReadingHomePage from './pages/ReadingHomePage'
import ReadingReviewPage from './pages/ReadingReviewPage'
import ReadingPage from './pages/ReadingPage'
import './App.css'

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">职事英语</span>
        <nav className="topnav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            上传
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => (isActive ? 'active' : '')}>
            统计
          </NavLink>
          <NavLink to="/vocab" className={({ isActive }) => (isActive ? 'active' : '')}>
            生词本
          </NavLink>
          <NavLink to="/reading" className={({ isActive }) => (isActive ? 'active' : '')}>
            阅读中心
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/practice/:mediaId" element={<PracticePage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/vocab" element={<VocabPage />} />
          <Route path="/reading" element={<ReadingHomePage />} />
          <Route path="/reading/review/:bookId" element={<ReadingReviewPage />} />
          <Route path="/reading/:bookId" element={<ReadingPage />} />
        </Routes>
      </main>
    </div>
  )
}
