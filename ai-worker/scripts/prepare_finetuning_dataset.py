import json
import os
import glob
from docx import Document
import difflib

def read_docx_paragraphs(filepath):
    doc = Document(filepath)
    return [p.text.strip() for p in doc.paragraphs if p.text.strip()]

def align_and_export(original_dir, corrected_dir, output_file):
    dataset = []
    
    original_files = glob.glob(os.path.join(original_dir, "*.docx"))
    
    for orig_path in original_files:
        filename = os.path.basename(orig_path)
        corr_path = os.path.join(corrected_dir, filename)
        
        if not os.path.exists(corr_path):
            print(f"Warning: Match not found for {filename} in corrected folder.")
            continue
            
        print(f"Processing {filename}...")
        
        orig_paras = read_docx_paragraphs(orig_path)
        corr_paras = read_docx_paragraphs(corr_path)
        
        # Simple 1-to-1 alignment if lengths match, else attempt basic matching
        if len(orig_paras) == len(corr_paras):
            for o, c in zip(orig_paras, corr_paras):
                if o != c: # Only include if there was a correction
                    dataset.append({
                        "messages": [
                            {
                                "role": "system",
                                "content": "Eres un asistente experto en corrección editorial y ortotipográfica en español. Tu tarea es corregir el texto proporcionado respetando el estilo del autor y aplicando las normativas de la RAE y buenas prácticas editoriales."
                            },
                            {
                                "role": "user",
                                "content": f"Corrige el siguiente fragmento:\n\n{o}"
                            },
                            {
                                "role": "model",
                                "content": c
                            }
                        ]
                    })
        else:
            print(f"Warning: Paragraph count mismatch in {filename}. Original: {len(orig_paras)}, Corrected: {len(corr_paras)}. Skipping for automatic 1-to-1 alignment.")

    # Write JSONL
    with open(output_file, 'w', encoding='utf-8') as f:
        for entry in dataset:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            
    print(f"Dataset preparation complete. Generated {len(dataset)} training examples in {output_file}.")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Prepare Gemini Fine-Tuning dataset from Word documents.")
    parser.add_argument("--original", type=str, required=True, help="Directory containing original .docx files")
    parser.add_argument("--corrected", type=str, required=True, help="Directory containing corrected .docx files")
    parser.add_argument("--output", type=str, default="finetuning_dataset.jsonl", help="Output JSONL filename")
    
    args = parser.parse_args()
    align_and_export(args.original, args.corrected, args.output)
