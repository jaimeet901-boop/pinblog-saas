import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnimatedText } from '@/hooks/use-animated-text';
import { useIntegratedAi } from '@/hooks/use-integrated-ai';

const MAX_IMAGES = 10;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const getImageKey = file => `${file.name}:${file.size}:${file.lastModified}`;

export default function IntegratedAiChat() {
	const [input, setInput] = useState('');
	const [selectedImages, setSelectedImages] = useState([]);
	const { messages, isStreaming, isLoadingHistory, sendMessage, clearMessages } = useIntegratedAi();
	const messagesEndRef = useRef(null);
	const fileInputRef = useRef(null);

	const imagePreviews = useMemo(() => selectedImages.map(file => ({
		key: getImageKey(file),
		file,
		url: URL.createObjectURL(file),
	})), [selectedImages]);

	useEffect(() => () => {
		imagePreviews.forEach(preview => URL.revokeObjectURL(preview.url));
	}, [imagePreviews]);

	const lastMessage = messages[messages.length - 1];
	const isLastMessageStreaming = isStreaming && lastMessage?.role === 'assistant';
	const animatedText = useAnimatedText(isLastMessageStreaming ? lastMessage.content : '');

	useEffect(() => {
		const scrollToBottom = () => {
			if (messagesEndRef.current) {
				messagesEndRef.current.scrollIntoView({
					behavior: 'smooth',
					block: 'end',
				});
			}
		};

		scrollToBottom();
	}, [messages]);

	const handleSubmit = useCallback((e) => {
		e.preventDefault();

		const trimmed = input.trim();

		if ((!trimmed && selectedImages.length === 0) || isStreaming) {
			return;
		}

		setInput('');
		sendMessage(trimmed, selectedImages);
		setSelectedImages([]);
	}, [input, selectedImages, isStreaming, sendMessage]);

	const handleImageSelect = useCallback((e) => {
		const files = Array.from(e.target.files || []);
		const validFiles = files.filter(file => VALID_IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_SIZE);

		setSelectedImages((prev) => {
			const uniqueFilesMap = new Map(prev.map(file => [getImageKey(file), file]));
			validFiles.forEach(file => uniqueFilesMap.set(getImageKey(file), file));
			return Array.from(uniqueFilesMap.values()).slice(0, MAX_IMAGES);
		});

		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	}, [fileInputRef]);

	const removeImage = useCallback((index) => {
		setSelectedImages(prev => prev.filter((_, i) => i !== index));
	}, []);

	return (
		<div className="flex flex-col h-full max-w-2xl mx-auto">
			<div className="flex items-center justify-between p-4 border-b">
				<h2 className="text-lg font-semibold">AI Chat</h2>
			{messages.length > 0 && (
				<button
					onClick={clearMessages}
					disabled={isStreaming}
					className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Clear
				</button>
			)}
			</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
				{isLoadingHistory && (
					<div className="text-center text-sm text-gray-400 py-4">Loading history...</div>
				)}
				{messages.map((msg, i) => {
					const isLastStreamingMessage = isStreaming && i === messages.length - 1 && msg.role === 'assistant';
					const displayContent = isLastStreamingMessage ? animatedText : msg.content;

					return (
						<div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
							<div
								className={`max-w-[80%] rounded-lg px-4 py-2 ${
									msg.role === 'user'
										? 'bg-blue-600 text-white'
										: 'bg-gray-100 text-gray-900'
								}`}
							>
								<p className="whitespace-pre-wrap">{displayContent}</p>
								{msg.images?.map((url, j) => (
									<img
										key={j}
										src={url}
										alt="AI generated"
										className="mt-2 rounded max-w-full"
									/>
								))}
								{msg.role === 'assistant' && isStreaming && i === messages.length - 1 && !msg.content && (
									<span className="inline-block w-2 h-4 bg-gray-400 animate-pulse" />
								)}
							</div>
						</div>
					);
				})}
				<div ref={messagesEndRef} />
			</div>

			<div className="p-4 border-t">
				{selectedImages.length > 0 && (
					<div className="mb-3 flex gap-2 flex-wrap">
						{imagePreviews.map(({ key, file, url }, index) => (
							<div key={key} className="relative group">
								<img
									src={url}
									alt={file.name}
									className="w-20 h-20 object-cover rounded-lg border"
								/>
								<button
									type="button"
									onClick={() => removeImage(index)}
									className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									×
								</button>
							</div>
						))}
					</div>
				)}
				<form onSubmit={handleSubmit} className="flex gap-2">
					<input
						ref={fileInputRef}
						type="file"
						accept={VALID_IMAGE_TYPES.join(',')}
						multiple
						onChange={handleImageSelect}
						className="hidden"
						disabled={isStreaming || isLoadingHistory}
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="rounded-lg border px-3 py-2 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
						disabled={isStreaming || isLoadingHistory || selectedImages.length >= MAX_IMAGES}
						title="Upload images"
					>
						📎
					</button>
					<input
						type="text"
						value={input}
						onChange={e => setInput(e.target.value)}
						placeholder="Type a message..."
						className="flex-1 rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
						disabled={isStreaming || isLoadingHistory}
					/>
					<button
						type="submit"
						disabled={isStreaming || (!input.trim() && selectedImages.length === 0)}
						className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						Send
					</button>
				</form>
			</div>
		</div>
	);
}
