class PDFMerger {
    constructor() {
        this.pdf1 = null;
        this.pdf2 = null;
        this.mergedPdfBytes = null;

        // Wait for PDF-lib to be available
        this.waitForPDFLib().then(() => {
            this.initializeElements();
            this.bindEvents();
        });
    }

    async waitForPDFLib() {
        let attempts = 0;
        while (typeof PDFLib === 'undefined' && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (typeof PDFLib === 'undefined') {
            throw new Error('PDF-lib library failed to load');
        }
    }

    initializeElements() {
        this.pdf1Input = document.getElementById('pdf1');
        this.pdf2Input = document.getElementById('pdf2');
        this.file1Info = document.getElementById('file1-info');
        this.file2Info = document.getElementById('file2-info');
        this.mergeBtn = document.getElementById('mergeBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.filenameInput = document.getElementById('filename');
        this.progressSection = document.getElementById('progressSection');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');
        this.resultSection = document.getElementById('resultSection');
    }

    bindEvents() {
        this.pdf1Input.addEventListener('change', (e) => this.handleFileUpload(e, 1));
        this.pdf2Input.addEventListener('change', (e) => this.handleFileUpload(e, 2));
        this.mergeBtn.addEventListener('click', () => this.mergePDFs());
        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.downloadBtn.addEventListener('click', () => this.downloadMergedPDF());

        this.setupDragAndDrop();
    }

    setupDragAndDrop() {
        const fileLabels = document.querySelectorAll('.file-label');

        fileLabels.forEach((label, index) => {
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                label.addEventListener(eventName, this.preventDefaults, false);
            });

            ['dragenter', 'dragover'].forEach(eventName => {
                label.addEventListener(eventName, () => this.highlight(label), false);
            });

            ['dragleave', 'drop'].forEach(eventName => {
                label.addEventListener(eventName, () => this.unhighlight(label), false);
            });

            label.addEventListener('drop', (e) => this.handleDrop(e, index + 1), false);
        });
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    highlight(element) {
        element.style.borderColor = 'var(--primary-color)';
        element.style.backgroundColor = 'var(--hover-bg)';
    }

    unhighlight(element) {
        element.style.borderColor = 'var(--border-color)';
        element.style.backgroundColor = 'var(--secondary-bg)';
    }

    handleDrop(e, fileNumber) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            const file = files[0];
            this.processFileSelection(file, fileNumber);
        }
    }

    async handleFileUpload(event, fileNumber) {
        const file = event.target.files[0];
        if (file) {
            await this.processFileSelection(file, fileNumber);
        }
    }

    async processFileSelection(file, fileNumber) {
        console.log('Processing file:', file.name, 'Type:', file.type, 'Size:', file.size);

        // Basic validation
        if (!file) {
            this.showError('No file selected.');
            return;
        }

        // Check file size (50MB limit)
        if (file.size > 52428800) { // 50MB
            this.showError('File is too large. Please select a file smaller than 50MB.');
            return;
        }

        // Check if file is empty
        if (file.size === 0) {
            this.showError('Selected file is empty.');
            return;
        }

        // Show loading state
        this.showLoadingState(fileNumber);

        try {
            await this.loadPDF(file, fileNumber);
        } catch (error) {
            console.error('Error processing file:', error);
            this.resetFileState(fileNumber);

            if (error.message.includes('Invalid PDF')) {
                this.showError('This file is not a valid PDF. Please select a proper PDF file.');
            } else if (error.message.includes('password') || error.message.includes('encrypted')) {
                this.showError('This PDF is password-protected. Please use an unprotected PDF.');
            } else if (error.message.includes('corrupted')) {
                this.showError('This PDF file appears to be corrupted. Please try a different file.');
            } else {
                this.showError(`Error loading PDF: ${file.name}. Please try a different file.`);
            }
        }
    }

    async loadPDF(file, fileNumber) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // Validate PDF header
                    if (!this.isValidPDFFile(uint8Array)) {
                        reject(new Error('Invalid PDF file format'));
                        return;
                    }

                    // Load PDF with error handling
                    let pdfDoc;
                    try {
                        pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, {
                            ignoreEncryption: false,
                            parseSpeed: PDFLib.ParseSpeeds.Fastest,
                            throwOnInvalidObject: false
                        });
                    } catch (pdfError) {
                        console.error('PDF-lib error:', pdfError);
                        if (pdfError.message.includes('password') || pdfError.message.includes('encrypted')) {
                            reject(new Error('Password protected PDF'));
                        } else {
                            reject(new Error('Corrupted or invalid PDF'));
                        }
                        return;
                    }

                    // Verify the PDF has pages
                    const pageCount = pdfDoc.getPageCount();
                    if (pageCount === 0) {
                        reject(new Error('PDF has no pages'));
                        return;
                    }

                    // Success - store the PDF
                    if (fileNumber === 1) {
                        this.pdf1 = { doc: pdfDoc, file: file };
                        this.updateFileInfo(this.file1Info, file, pdfDoc);
                        this.updateFileLabel(this.pdf1Input.parentElement.querySelector('.file-label'), file);
                    } else {
                        this.pdf2 = { doc: pdfDoc, file: file };
                        this.updateFileInfo(this.file2Info, file, pdfDoc);
                        this.updateFileLabel(this.pdf2Input.parentElement.querySelector('.file-label'), file);
                    }

                    this.updateMergeButton();
                    resolve();

                } catch (error) {
                    console.error('File reading error:', error);
                    reject(error);
                }
            };

            reader.onerror = () => {
                reject(new Error('Error reading file'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    isValidPDFFile(uint8Array) {
        // Check for PDF signature at the beginning
        const pdfSignature = [0x25, 0x50, 0x44, 0x46]; // %PDF

        if (uint8Array.length < 4) return false;

        for (let i = 0; i < pdfSignature.length; i++) {
            if (uint8Array[i] !== pdfSignature[i]) {
                return false;
            }
        }

        return true;
    }

    showLoadingState(fileNumber) {
        const label = fileNumber === 1 ?
            this.pdf1Input.parentElement.querySelector('.file-label') :
            this.pdf2Input.parentElement.querySelector('.file-label');

        if (label) {
            label.style.opacity = '0.7';
            const span = label.querySelector('span');
            const icon = label.querySelector('i');
            if (span) span.textContent = 'Loading PDF...';
            if (icon) icon.className = 'fas fa-spinner fa-spin';
        }
    }

    resetFileState(fileNumber) {
        if (fileNumber === 1) {
            this.pdf1 = null;
            this.pdf1Input.value = '';
            this.file1Info.classList.remove('show');
            const label1 = this.pdf1Input.parentElement.querySelector('.file-label');
            this.resetFileLabel(label1, 'Select First PDF');
        } else {
            this.pdf2 = null;
            this.pdf2Input.value = '';
            this.file2Info.classList.remove('show');
            const label2 = this.pdf2Input.parentElement.querySelector('.file-label');
            this.resetFileLabel(label2, 'Select Second PDF');
        }
        this.updateMergeButton();
    }

    resetFileLabel(labelElement, text) {
        if (labelElement) {
            labelElement.classList.remove('success');
            labelElement.style.opacity = '1';
            const span = labelElement.querySelector('span');
            const icon = labelElement.querySelector('i');
            if (span) span.textContent = text;
            if (icon) icon.className = 'fas fa-cloud-upload-alt';
        }
    }

    updateFileInfo(infoElement, file, pdfDoc) {
        const pageCount = pdfDoc.getPageCount();
        const fileSize = this.formatFileSize(file.size);

        infoElement.innerHTML = `
            <i class="fas fa-file-pdf" style="color: #e74c3c; margin-right: 8px;"></i>
            <strong>${file.name}</strong><br>
            <span style="color: var(--text-secondary);">
                ${pageCount} page${pageCount !== 1 ? 's' : ''} • ${fileSize}
            </span>
        `;
        infoElement.classList.add('show');
    }

    updateFileLabel(labelElement, file) {
        if (labelElement) {
            labelElement.classList.add('success');
            labelElement.style.opacity = '1';
            const span = labelElement.querySelector('span');
            const icon = labelElement.querySelector('i');
            if (span) span.textContent = file.name;
            if (icon) icon.className = 'fas fa-check-circle';
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateMergeButton() {
        if (this.pdf1 && this.pdf2) {
            this.mergeBtn.disabled = false;
            this.mergeBtn.style.opacity = '1';
        } else {
            this.mergeBtn.disabled = true;
            this.mergeBtn.style.opacity = '0.6';
        }
    }

    async mergePDFs() {
        if (!this.pdf1 || !this.pdf2) {
            this.showError('Please select both PDF files before merging.');
            return;
        }

        try {
            this.showProgress();
            this.mergeBtn.classList.add('loading');
            this.mergeBtn.disabled = true;

            // Create new PDF document
            const mergedPdf = await PDFLib.PDFDocument.create();

            this.updateProgress(25, 'Preparing to merge...');

            // Copy pages from first PDF
            const pdf1PageCount = this.pdf1.doc.getPageCount();
            const pdf1Indices = Array.from({ length: pdf1PageCount }, (_, i) => i);
            const pdf1Pages = await mergedPdf.copyPages(this.pdf1.doc, pdf1Indices);

            this.updateProgress(50, 'Adding pages from first PDF...');

            pdf1Pages.forEach((page) => mergedPdf.addPage(page));

            // Copy pages from second PDF
            const pdf2PageCount = this.pdf2.doc.getPageCount();
            const pdf2Indices = Array.from({ length: pdf2PageCount }, (_, i) => i);
            const pdf2Pages = await mergedPdf.copyPages(this.pdf2.doc, pdf2Indices);

            this.updateProgress(75, 'Adding pages from second PDF...');

            pdf2Pages.forEach((page) => mergedPdf.addPage(page));

            this.updateProgress(90, 'Finalizing merged PDF...');

            // Generate the final PDF
            this.mergedPdfBytes = await mergedPdf.save();

            this.updateProgress(100, 'PDF merged successfully!');

            setTimeout(() => {
                this.hideProgress();
                this.showResult();
                this.mergeBtn.classList.remove('loading');
                this.mergeBtn.disabled = false;
            }, 1000);

        } catch (error) {
            this.hideProgress();
            this.mergeBtn.classList.remove('loading');
            this.mergeBtn.disabled = false;
            console.error('Merge error:', error);
            this.showError('Failed to merge PDFs. Please try again.');
        }
    }

    showProgress() {
        this.progressSection.style.display = 'block';
        this.resultSection.style.display = 'none';
    }

    hideProgress() {
        this.progressSection.style.display = 'none';
    }

    updateProgress(percentage, text) {
        this.progressFill.style.width = percentage + '%';
        this.progressText.textContent = text;
    }

    showResult() {
        this.resultSection.style.display = 'block';
    }

    downloadMergedPDF() {
        if (!this.mergedPdfBytes) {
            this.showError('No merged PDF available for download.');
            return;
        }

        try {
            const filename = this.filenameInput.value.trim() || 'merged-document';
            const blob = new Blob([this.mergedPdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename.endsWith('.pdf') ? filename : filename + '.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            URL.revokeObjectURL(url);

            // Success feedback
            const originalText = this.downloadBtn.innerHTML;
            this.downloadBtn.innerHTML = '<i class="fas fa-check"></i> Downloaded!';
            this.downloadBtn.style.background = 'var(--success-color)';

            setTimeout(() => {
                this.downloadBtn.innerHTML = originalText;
                this.downloadBtn.style.background = '';
            }, 2000);

        } catch (error) {
            console.error('Download error:', error);
            this.showError('Error downloading the merged PDF.');
        }
    }

    clearAll() {
        // Reset everything
        this.pdf1Input.value = '';
        this.pdf2Input.value = '';
        this.pdf1 = null;
        this.pdf2 = null;
        this.mergedPdfBytes = null;

        // Reset UI elements
        this.file1Info.classList.remove('show');
        this.file2Info.classList.remove('show');
        this.resultSection.style.display = 'none';
        this.progressSection.style.display = 'none';

        // Reset file labels
        const label1 = this.pdf1Input.parentElement.querySelector('.file-label');
        const label2 = this.pdf2Input.parentElement.querySelector('.file-label');
        this.resetFileLabel(label1, 'Select First PDF');
        this.resetFileLabel(label2, 'Select Second PDF');
        this.unhighlight(label1);
        this.unhighlight(label2);

        // Reset filename
        this.filenameInput.value = 'merged-document';
        this.updateMergeButton();

        // Feedback
        const originalText = this.clearBtn.innerHTML;
        this.clearBtn.innerHTML = '<i class="fas fa-check"></i> Cleared!';
        setTimeout(() => {
            this.clearBtn.innerHTML = originalText;
        }, 1500);
    }

    showError(message) {
        // Remove existing errors
        const existing = document.querySelectorAll('.error-toast');
        existing.forEach(el => el.remove());

        // Create error toast
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #dc3545;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 1000;
            max-width: 400px;
            animation: slideIn 0.3s ease;
            font-family: inherit;
        `;

        toast.innerHTML = `
            <i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i>
            ${message}
        `;

        document.body.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }
        }, 5000);
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        new PDFMerger();
    } catch (error) {
        console.error('Failed to initialize PDF Merger:', error);
        document.body.innerHTML = `
            <div style="text-align: center; padding: 50px; color: #dc3545; font-family: Arial, sans-serif;">
                <h2>Error Loading PDF Merger</h2>
                <p>The PDF library failed to load. Please refresh the page and try again.</p>
                <button onclick="location.reload()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Refresh Page
                </button>
            </div>
        `;
    }
});
