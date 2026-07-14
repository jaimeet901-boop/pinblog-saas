import multer from 'multer';

export const uploadFiles = ({
	maxCount = 5,
	maxSizeMB = 20,
	maxFieldSizeBytes = 256 * 1024,
	allowedMimeTypes,
	fieldName,
}) => {
	const upload = multer({
		storage: multer.memoryStorage(),
		limits: {
			fileSize: maxSizeMB * 1024 * 1024,
			fieldSize: maxFieldSizeBytes,
		},
		fileFilter: (req, file, cb) => {
			if (allowedMimeTypes.includes(file.mimetype)) {
				cb(null, true);
			} else {
				cb(new Error(`Invalid file type. Only ${allowedMimeTypes.join(', ')} are allowed.`));
			}
		},
	});

	return upload.array(fieldName, maxCount);
};
