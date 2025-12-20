const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'solar_simulator.html');
let content = fs.readFileSync(filePath, 'utf8');

// Find the style block
const styleStart = content.indexOf('<style>');
const styleEnd = content.indexOf('</style>', styleStart);

if (styleStart !== -1 && styleEnd !== -1) {
    // Find the comment inside the style block
    const commentPos = content.indexOf('/* Only keeping minimal critical overrides if needed */', styleStart);
    
    if (commentPos !== -1 && commentPos < styleEnd) {
        // Get everything before the comment line
        const beforeComment = content.substring(0, commentPos);
        // Get the comment line itself
        const commentLine = '        /* Only keeping minimal critical overrides if needed */';
        // Get everything after </style>
        const restAfterStyle = content.substring(styleEnd + 8); // +8 for '</style>'
        
        // Reconstruct with just the comment
        const newContent = beforeComment + commentLine + '\n    </style>' + restAfterStyle;
        
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('CSS cleaned successfully');
    } else {
        console.log('Comment not found in style block');
    }
} else {
    console.log('Style block not found');
}
