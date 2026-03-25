import os
import json
from docx import Document
import sys

def extract_paragraphs(docx_path):
    doc = Document(docx_path)
    return [p.text.strip() for p in doc.paragraphs if p.text.strip()]

def create_finetuning_dataset(original_dir, corrected_dir, output_file):
    """
    Toma dos directorios (uno con los libros originales y otro con los corregidos)
    y alinea los párrafos para generar un .jsonl de entrenamiento para el BSC GPT-2.
    """
    dataset = []
    
    original_files = sorted(os.listdir(original_dir))
    
    for filename in original_files:
        if not filename.endswith('.docx'):
            continue
            
        orig_path = os.path.join(original_dir, filename)
        corr_path = os.path.join(corrected_dir, filename)
        
        if not os.path.exists(corr_path):
            print(f"Warning: No se encontró la versión corregida de {filename}")
            continue
            
        orig_paras = extract_paragraphs(orig_path)
        corr_paras = extract_paragraphs(corr_path)
        
        # Alineamiento naive (1 a 1). En producción requiere un alineador como difflib o bi-encoder
        # si los párrafos se dividieron por error durante la edición humana.
        min_len = min(len(orig_paras), len(corr_paras))
        
        for i in range(min_len):
            if orig_paras[i] != corr_paras[i]: # Solo guardamos donde hubo corrección
                dataset.append({
                    "prompt": f"<original>{orig_paras[i]}</original><corrected>",
                    "completion": corr_paras[i]
                })

    with open(output_file, 'w', encoding='utf-8') as f:
        for item in dataset:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')
            
    print(f"Dataset generado en {output_file} con {len(dataset)} ejemplos de entrenamiento.")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python prepare_dataset.py <dir_original> <dir_corregido> <output.jsonl>")
        sys.exit(1)
        
    create_finetuning_dataset(sys.argv[1], sys.argv[2], sys.argv[3])
