import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
	const [theme, setTheme] = useState(() => localStorage.getItem('chefia-theme') || 'light');

	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle('dark', theme === 'dark');
		localStorage.setItem('chefia-theme', theme);
	}, [theme]);

	const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

	return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	return useContext(ThemeContext);
}
