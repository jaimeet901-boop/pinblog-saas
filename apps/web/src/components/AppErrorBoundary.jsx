import React from 'react';
import AppErrorPage from '@/pages/AppErrorPage';

export default class AppErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error) {
		console.error('UI runtime error:', error);
	}

	render() {
		if (this.state.hasError) {
			return <AppErrorPage />;
		}

		return this.props.children;
	}
}
