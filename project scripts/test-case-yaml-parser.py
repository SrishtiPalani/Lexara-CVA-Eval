"""
Test Case YAML Parser

This script parses YAML files containing test case definitions and converts them
into a tabular CSV format for analysis and review. It extracts test case metadata,
utterances, and notional specifications into a structured table.

Usage:
    python test-case-yaml-parser.py

Author: Research Team
"""

import yaml
import pandas as pd

def parse_yaml_to_table(file_path: str) -> pd.DataFrame:
    """
    Parse a YAML file containing test case definitions and convert to DataFrame.
    
    The YAML file should contain an array of test cases, each with metadata like
    test number, description, requirement ID, and utterances. Each utterance
    contains canonical text, paraphrases, labels, and notional specifications.
    
    Args:
        file_path (str): Path to the YAML file containing test case definitions
        
    Returns:
        pd.DataFrame: DataFrame with columns for test case metadata and utterance data
        
    Raises:
        FileNotFoundError: If the YAML file doesn't exist
        yaml.YAMLError: If the YAML file is malformed
    """
    # Load and parse the YAML file
    with open(file_path, 'r') as file:
        parsed_test_cases = yaml.safe_load(file)
    
    # List to store all flattened rows
    all_rows = []
    
    # Process each test case in the YAML file
    for test_case in parsed_test_cases:
        # Extract test case metadata
        test_number = test_case.get("test-number", None)
        description = test_case.get("description", "")
        requirement_id = test_case.get("requirement-id", "")
        
        # Process each utterance within the test case
        for utterance in test_case.get("utterances", []):
            # Create a flattened row combining test case and utterance data
            row = {
                "Test Case Number": test_number,
                "Description": description,
                "Requirement ID": requirement_id,
                "Labels": ", ".join(utterance.get("labels", [])),
                "Canonical Utterance": utterance.get("canonical", ""),
                "Paraphrase Utterance": ", ".join(utterance.get("paraphrase", [])),
                "Notional Spec Out": yaml.dump(utterance.get("notional-spec-out", {})),
            }
            all_rows.append(row)
    
    # Convert list of dictionaries to pandas DataFrame
    return pd.DataFrame(all_rows)

# Configuration: Specify the YAML file path
# Note: Update this path according to your local setup
file_path = "/path/to/your/test-cases.yaml"

if __name__ == "__main__":
    # Parse the YAML file and create the table
    parsed_table = parse_yaml_to_table(file_path)

    # Save the parsed data as CSV file
    parsed_table.to_csv("parsed_test_cases.csv", index=False)
    print("Parsed test cases saved to parsed_test_cases.csv")
    
    # Display the table in console
    print(parsed_table)
